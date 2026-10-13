import { open as nativeOpen, type OpenDialogOptions } from '@tauri-apps/plugin-dialog';

type Picker = (options?: OpenDialogOptions) => Promise<string | string[] | null>;
let testPicker: Picker | undefined;
export function setDialogTestAdapter(picker: Picker | undefined): void {
  testPicker = picker;
}
export const open: Picker = (options) => (testPicker ?? nativeOpen)(options);
