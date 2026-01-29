/**
 * Result type utilities for explicit error handling
 * Avoids throwing exceptions in domain logic
 */

export type Result<T, E = Error> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
    return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
    return !result.ok;
}

export function unwrap<T, E>(result: Result<T, E>): T {
    if (result.ok) {
        return result.value;
    }
    throw result.error;
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
}

export function mapResult<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => U
): Result<U, E> {
    return result.ok ? ok(fn(result.value)) : result;
}

export async function tryCatch<T>(
    fn: () => Promise<T>,
    errorMessage?: string
): Promise<Result<T, Error>> {
    try {
        const value = await fn();
        return ok(value);
    } catch (error) {
        const message = errorMessage ?? 'Operation failed';
        return err(error instanceof Error ? error : new Error(`${message}: ${String(error)}`));
    }
}

export function tryCatchSync<T>(
    fn: () => T,
    errorMessage?: string
): Result<T, Error> {
    try {
        const value = fn();
        return ok(value);
    } catch (error) {
        const message = errorMessage ?? 'Operation failed';
        return err(error instanceof Error ? error : new Error(`${message}: ${String(error)}`));
    }
}
