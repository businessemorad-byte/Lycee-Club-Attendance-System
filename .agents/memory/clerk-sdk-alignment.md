---
name: Clerk SDK alignment
description: Keep the Replit-managed Clerk integration compatible with the versions resolved by this workspace.
---

Check the workspace's resolved Clerk package versions and actual exports rather than assuming an integration snippet matches the installed SDK. A clean TypeScript check is not sufficient; also verify a production bundle.

**Why:** The Clerk React 5 package resolved successfully but failed during Vite bundling against its paired shared runtime. The current React 6 package and shared runtime bundle together correctly, while older setup examples referred to exports absent from the resolved package.

**How to apply:** Before changing Clerk imports or upgrading its SDK, inspect the resolved `@clerk/react` and `@clerk/shared` versions, use APIs exported by that pair, then run both typecheck and a production build.