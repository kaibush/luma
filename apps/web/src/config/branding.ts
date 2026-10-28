export const APP_NAME = 'Luma 灵幕'

// Keep custom workspace names while updating the server's legacy default.
export function getWorkspaceName(name: string) {
  return name === 'Remote Console' ? APP_NAME : name
}
