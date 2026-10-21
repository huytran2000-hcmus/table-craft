/**
 * Counts the renderer ports an engine serves. The engine has no idle timeout (plan 004): it lives
 * while any port is open and ends when the last one closes, so a disconnected datasource leaves
 * no process behind.
 */
export interface Lifetime {
  attached(): void;
  detached(): void;
}

export function createLifetime(onIdle: () => void): Lifetime {
  let open = 0;
  return {
    attached() {
      open += 1;
    },
    detached() {
      if (open === 0) return;
      open -= 1;
      if (open === 0) onIdle();
    },
  };
}
