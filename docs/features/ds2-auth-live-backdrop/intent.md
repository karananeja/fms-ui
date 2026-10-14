# DS2 — Auth Screens "Live Ops" Backdrop · Intent

**Status:** Direction chosen by the user on 2026-10-14 ("Live ops backdrop", from 3 options: live ops backdrop / split hero / subtle polish). Final confirmation via UAT.

## Why
User: "upgrade the auth screen, add some animation currently it looks too dull". The F02 screens were a static grid with a plain card.

## What
Applies to every auth screen (sign in, forgot / reset password, accept invite), through the shared `AuthLayout`:
- **Moving vehicles:** glowing dots travel along the existing street-grid lines, turn at intersections and leave fading trails. Canvas 2D, 10–26 dots by screen area, colours from the DS1 tokens.
- **Radar sweep:** a soft teal sweep with a glow rotates slowly behind the card.
- **Entrance:** the card rises in, then its fields appear one by one. The brand mark pulses gently, and a shine passes over the submit button every few seconds.
- **Reduced motion:** with `prefers-reduced-motion`, everything is still: one static frame of dots, and no sweep, entrance or shine.
- Dark DS1 theme and Doto only, with no new dependencies.

## Out of scope
Changes to any form behaviour, copy or validation (F02 unchanged); the light/public share page.
