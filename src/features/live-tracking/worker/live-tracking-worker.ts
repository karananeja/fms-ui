import { expose } from 'comlink';
import { WS_PATH } from '@shared/contract/ws-protocol.ts';
import { LiveTrackingEngine } from './live-tracking-engine.ts';
import type { SocketLike } from './ws-client.ts';

expose(
  new LiveTrackingEngine({
    url: `${self.location.origin.replace(/^http/, 'ws')}${WS_PATH}`,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    onDispose: () => self.close(),
  }),
);
