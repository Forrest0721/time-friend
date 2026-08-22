# Time Friend

This repository is the foundation for **Time Friend** (time-friend).

Goal for v1: close the loop for task execution + focus time + trajectory review.

## Monorepo Structure

- `apps/web`: React + Next.js frontend
- `apps/api`: Fastify backend
- `apps/worker`: scheduled worker for reviews and memory generation
- `packages/shared`: shared TypeScript types and utility logic
- `packages/db`: database schema and migration wrappers

## Scripts

- `pnpm install`: install workspace dependencies
- `pnpm dev`: start web/api/worker in parallel where scripts exist
- `pnpm build`: build all workspace packages
- `pnpm lint`: lint all packages
- `pnpm test`: run tests in all packages
- `pnpm typecheck`: run type checking in all packages
- `pnpm db:generate`: generate DB artifacts in `packages/db`

## Git Remote

- Remote repository target: `git@github.com:Forrest0721/time-friend.git`
- Example:
  - `git remote add origin git@github.com:Forrest0721/time-friend.git`
  - `git push -u origin main`

## Suggested Next Step

1. run `pnpm install`
2. create the first base branch and sync with GitHub
3. scaffold API contracts in `packages/shared`
