declare module 'pptx-preview' {
  export function init(
    element: HTMLElement,
    options?: { width?: number; height?: number },
  ): { preview: (data: ArrayBuffer) => Promise<void> | void }
}
