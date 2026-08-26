// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FocusedDialog } from '../../../src/components/workbench/FocusedDialog';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const initialFocusRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开对话框
      </button>
      <FocusedDialog
        open={open}
        title="确认变更"
        onClose={() => setOpen(false)}
        initialFocusRef={initialFocusRef}
        footer={<button type="button">保存</button>}
      >
        <label>
          名称
          <input ref={initialFocusRef} />
        </label>
      </FocusedDialog>
    </>
  );
}

describe('FocusedDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('moves focus into the dialog, traps Tab, closes on Escape, and restores the trigger', () => {
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: '打开对话框' });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByRole('textbox', { name: '名称' });
    const closeButton = screen.getByRole('button', { name: '关闭对话框' });
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(document.activeElement).toBe(input);

    saveButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
