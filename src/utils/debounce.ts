export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => unknown,
  delayMs: number
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
