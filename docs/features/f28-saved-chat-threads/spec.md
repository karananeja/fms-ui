# F28 — Saved Ask FMS conversations · Spec

**Status:** Draft, 2026-10-16. Waiting for sign-off. Intent signed off 2026-10-16.
**Depends on:** F17 (global chat), F23 (chat UX), D-155 (turn outcomes and Retry), D-158 (canvas and copy button).
**Proposed decisions:** D-163 (storage and API), D-164 (panel behaviour), D-165 (limits and retention).

## 1. Today and the change

| | Today | After F28 |
|---|---|---|
| Where the global chat lives | `AssistantStore` in browser memory; lost on reload, sign-out or another device | SQLite, one thread per conversation, per user |
| What the client sends | `POST /api/chat { messages: [...] }`: the whole transcript (≤ 30 turns) | `POST /api/chat { threadId?, message, retryOf? }`: only the new message; the server rebuilds the transcript from the stored thread |
| History | none | New chat, history list, search, rename, delete |
| Outcomes and Retry | in memory only | stored per reply (`done`, `error`, `interrupted`, `stopped`), Retry after a reload (as D-155) |

Dashboard chats are unchanged: they stay on their dashboards (`dashboard_messages`) and are not listed in the Ask FMS history.

## 2. Data model (migration v14)

```sql
CREATE TABLE chat_threads (
  id              TEXT PRIMARY KEY,               -- thr-<uuid>
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  title_auto      INTEGER NOT NULL DEFAULT 1,     -- 0 once the user renames it
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL                -- last message or rename
);
CREATE INDEX chat_threads_user ON chat_threads (user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,                   -- msg-<uuid>
  thread_id   TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text        TEXT NOT NULL,
  extras_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extras_json)),
  outcome     TEXT NOT NULL DEFAULT 'done' CHECK (outcome IN ('done','error','interrupted','stopped')),
  error_code  TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (thread_id, seq)
);
```

`extras_json` keeps what the reply showed besides text: tool chips (`{ tool, label, status }`), report descriptors, dashboard links, entity references and, from F29, action cards. Widget data and report files are never stored (reports still expire after 15 minutes).

Store: `mock-server/store/chat-threads.ts`, write-through like the other F22 stores, hydrated on start. Deleting a user deletes their threads.

## 3. Contract (`shared/contract/chat-threads.ts`, `assistant.ts`)

| Method and path | Body / query | Response | Errors |
|---|---|---|---|
| `GET /api/chat/threads` | `q?` (title contains, ≤ 60 chars), `before?` (cursor) | `{ items: ThreadSummary[], nextCursor: string \| null }`, 50 per page, newest `updatedAt` first | — |
| `GET /api/chat/threads/:id` | — | `{ thread: ThreadSummary, messages: ChatThreadMessage[] }` | 404 `not_found` |
| `PATCH /api/chat/threads/:id` | `{ title }` (1–80 chars, trimmed) | `ThreadSummary` (sets `titleAuto: false`) | 404, 422 |
| `DELETE /api/chat/threads/:id` | — | 204 | 404 |
| `POST /api/chat` (SSE) | `{ threadId?, message, retryOf? }` | events as today, plus `thread_saved` | 404 (thread), 409 `chat_busy` (a turn already runs in this thread), 409 `not_retryable` |
| `POST /api/chat/threads/:id/stop` | — | 204 once the stopped turn is saved | 404 |

- `ThreadSummary = { id, title, titleAuto, createdAt, updatedAt, preview }`, where `preview` is the start of the last user message (≤ 80 chars).
- `ChatThreadMessage = { id, seq, role, text, extras, outcome, errorCode, createdAt }`.
- **Thread ownership:** every route answers only for the caller's own threads. Another user's thread is 404, not 403, so ids reveal nothing. No admin route reads other users' chats.
- **First message:** without `threadId`, the server creates the thread, titles it from the prompt (`titleFromPrompt`, as dashboards do) and sends `{ type: 'thread_saved', threadId, title, messages }` before the first text delta. With `threadId`, `thread_saved` carries the stored user message (and, at the end, the assistant message), as the dashboard chat does today.
- **Transcript:** the server sends the model the last 30 turns of the stored thread (`CHAT_MAX_TURNS`), the same way `threadToMessages` does for dashboards, so the cached prefix stays byte-stable (F24).
- **Retry:** `retryOf` = the id of the latest assistant message when it did not end `done`. That turn is re-run in place, so there is no second user message (D-155 rules).
- **Removed:** the `messages` array body of `POST /api/chat`. The only client is this app, so there is no compatibility shim.

## 4. Behaviour

- **Auto-title:** from the first prompt. A renamed thread keeps its title.
- **One turn at a time per thread.** A second tab sending into the same thread gets 409 `chat_busy`, and its prompt goes back into the box (as F27). Different threads can run at the same time.
- **Stop and leaving:** Stop and closing the tab store the reply as `stopped` or `interrupted`, with Retry (D-155).
- **Reports:** a stored report card reads "This report has expired. Ask again to rebuild it." once its 15 minutes are up.
- **Dashboards created from the global chat:** the link card is stored. The new dashboard still gets the creating turn in its own thread (F19 Q2).
- **Sign-out:** the client drops the open thread from memory. After sign-in the history comes from the server.

## 5. UI (Ask FMS panel)

- **Header:** **New chat** (a new, empty conversation; no server row until the first message) and **History**.
- **History:** a list inside the panel (a full-height sheet on phones):
  - search box (filters by title)
  - rows show title, preview and relative time, newest first, with the open thread highlighted
  - row menu: **Rename** (inline field) and **Delete** (inline confirm "Delete this conversation? This can't be undone.")
  - "Load more" after 50 rows
  - empty state: "No conversations yet. Ask anything about your fleet to start one."
- **Opening the panel:** shows the thread used last in this browser tab. Without one, the most recent thread if it was updated in the last 12 hours, else a new chat.
- **A deleted open thread** turns into a new chat with the toast "Conversation deleted".
- **Unchanged:** suggested prompts on an empty chat, type-ahead, voice input, the copy button on sent prompts (D-158), and Retry on failed replies.

## 6. Limits (D-165)

- **Threads:** 200 per user. Creating the 201st deletes the least recently updated one.
- **Messages:** 400 per thread. After that, the oldest turns are dropped from storage, and the history row says "Earlier messages were removed". Only the last 30 turns are ever sent to the model.
- **Budgets:**
  - thread list ≤ 50 ms server time
  - opening a 400-message thread ≤ 150 ms server time, first paint ≤ 300 ms
  - a stored turn adds ≤ 2 ms

## 7. Acceptance tests

| ID | Level | What it proves |
|---|---|---|
| F28-T1 | store + API | The first message creates a thread with an auto title; the reply is stored with its extras and outcome; the transcript the model gets is rebuilt from the stored thread (last 30 turns) |
| F28-T2 | API | List (paging, `q`), rename (`titleAuto: false`), delete; the 200-thread cap prunes the oldest; another user's thread is 404 on every route |
| F28-T3 | API | Retry re-runs the latest failed turn in place (no duplicate user message); 409 `not_retryable` otherwise; Stop stores `stopped`; a second sender gets 409 `chat_busy` |
| F28-T4 | API + client | A stored report card and dashboard link render after a reload; an expired report shows its expiry note |
| F28-T5 | client store | Reopen continues the thread; New chat starts empty and creates a row only on send; the panel reopens the right thread |
| F28-T6 | e2e (fake model) | New chat → send → reload → still there → History → open an older chat → continue → rename → delete |
| F28-T7 | e2e | A second browser for the same user sees the same history; another user sees none of it |
| F28-T8 | migration | v14 applies on an existing v13 database, and a later restart keeps the threads |

## 8. Out of scope

Sharing or exporting conversations, folders and pinning, admin access to other people's chats, moving dashboard chats into this list, and retention rules other than §6.
