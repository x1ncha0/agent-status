export interface Bounds { x: number; y: number; width: number; height: number }
export const DEFAULT_SIZE = { width: 110, height: 55 };
export const MIN_SIZE = { width: 90, height: 45 };

export function fitBounds(bounds: Bounds, work: Bounds): Bounds {
  const width = Math.min(work.width, Math.max(MIN_SIZE.width, bounds.width));
  const height = Math.min(work.height, Math.max(MIN_SIZE.height, bounds.height));
  return {
    x: Math.max(work.x, Math.min(bounds.x, work.x + work.width - width)),
    y: Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)),
    width, height
  };
}

export function restoreBounds(saved: unknown, work: Bounds): Bounds {
  const value = saved && typeof saved === 'object' ? saved as Partial<Bounds> : {};
  return fitBounds({
    x: Number.isSafeInteger(value.x) ? value.x! : work.x + work.width - DEFAULT_SIZE.width - 16,
    y: Number.isSafeInteger(value.y) ? value.y! : work.y + work.height - DEFAULT_SIZE.height - 16,
    width: Number.isSafeInteger(value.width) && value.width! > 0 ? value.width! : DEFAULT_SIZE.width,
    height: Number.isSafeInteger(value.height) && value.height! > 0 ? value.height! : DEFAULT_SIZE.height
  }, work);
}
