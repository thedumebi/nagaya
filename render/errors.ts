// A problem with sites.yaml itself. `pnpm render` prints its message, which
// always starts with where in the file the problem is, and exits 1.
export class RegistryError extends Error {}
