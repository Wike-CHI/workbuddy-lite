export interface WidgetHandle {
  exportImage: () => Promise<string | null> | string | null
}
