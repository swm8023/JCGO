if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () =>
      ({
      measureText: () => ({ width: 0 }),
      }) as unknown as CanvasRenderingContext2D,
  })
}
