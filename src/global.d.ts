export {}

declare global {
  interface Window {
    i18next?: {
      language: string
    };
  }
  interface Event {
    path: Array<HTMLElement>
  }
}