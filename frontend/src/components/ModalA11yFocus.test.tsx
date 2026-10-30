import React, { useRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { test, expect, vi, describe, afterEach } from 'vitest';
import { useModalA11y } from '../hooks/useModalA11y';

function TestModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, onClose, modalRef);

  if (!isOpen) return null;

  return (
    <div data-testid="modal-container">
      <div ref={modalRef} data-testid="modal-content">
        <input type="text" data-testid="input-1" />
        <button data-testid="button-2">Button</button>
        <a href="#" data-testid="link-3">Link</a>
      </div>
    </div>
  );
}

describe('useModalA11y Hook', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not call onClose when other keys are pressed', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  test('traps focus within the modal on Tab', () => {
    render(<TestModal isOpen={true} onClose={() => {}} />);

    const input1 = screen.getByTestId('input-1');
    const button2 = screen.getByTestId('button-2');
    const link3 = screen.getByTestId('link-3');

    // Start focus at the end
    link3.focus();
    expect(document.activeElement).toBe(link3);

    // Tab from last element should wrap to first
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(input1);
  });

  test('traps focus within the modal on Shift+Tab', () => {
    render(<TestModal isOpen={true} onClose={() => {}} />);

    const input1 = screen.getByTestId('input-1');
    const link3 = screen.getByTestId('link-3');

    // Start focus at the beginning
    input1.focus();
    expect(document.activeElement).toBe(input1);

    // Shift+Tab from first element should wrap to last
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(link3);
  });
});
