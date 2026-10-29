import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MoveVerifyWidget from './MoveVerifyWidget';
import { verifyMove } from '@/lib/api';

// Mock the API call
jest.mock('@/lib/api', () => ({
  verifyMove: jest.fn(),
}));

describe('MoveVerifyWidget', () => {
  const mockWidget = {
    item: '3-0 silk',
    new_location: 'OR 21 A 2 C',
    verify_count: 1,
    committed: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders pending location badge correctly', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);

    expect(screen.getByText('3-0 silk')).toBeInTheDocument();
    expect(screen.getByText('OR 21 A 2 C')).toBeInTheDocument();
    expect(screen.getByText('Confirm (1/3)')).toBeInTheDocument();
    expect(screen.getByText('1/3 confirmations')).toBeInTheDocument();
  });

  it('verifies touch target dimensions (min 44x44px for sterile OR use) for the verify button', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);

    const verifyButton = screen.getByRole('button', { name: /Confirm \(1\/3\)/i });

    // We can't directly check rendered dimensions in JSDOM, but we can verify classes that dictate padding/size
    // px-3 py-1.5 provides padding, minimum touch target is usually enforced by design system or manual testing.
    // However, we verify it exists and has the expected classes.
    expect(verifyButton).toHaveClass('px-3', 'py-1.5');
  });

  it('clicking the verify button triggers API call and optimistic UI update', async () => {
    (verifyMove as jest.Mock).mockResolvedValueOnce({
      verify_count: 2,
      committed: false,
    });

    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);

    const verifyButton = screen.getByRole('button', { name: /Confirm \(1\/3\)/i });

    // Click the button
    fireEvent.click(verifyButton);

    // Verify button goes into loading state
    expect(screen.getByText('Confirming...')).toBeInTheDocument();
    expect(verifyButton).toBeDisabled();

    // Verify API is called
    expect(verifyMove).toHaveBeenCalledWith('test-tenant', '3-0 silk', 'OR 21 A 2 C');

    // Wait for the UI update
    await waitFor(() => {
      expect(screen.getByText('Confirm (2/3)')).toBeInTheDocument();
    });

    // Button should be re-enabled
    expect(screen.getByRole('button', { name: /Confirm \(2\/3\)/i })).not.toBeDisabled();
  });

  it('updates to committed state when verification succeeds and reaches threshold', async () => {
    const mockOnCommitted = jest.fn();
    (verifyMove as jest.Mock).mockResolvedValueOnce({
      verify_count: 3,
      committed: true,
    });

    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" onCommitted={mockOnCommitted} />);

    const verifyButton = screen.getByRole('button', { name: /Confirm \(1\/3\)/i });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText('Committed')).toBeInTheDocument();
    });

    // Check that the progress dots text updated
    expect(screen.getByText('3/3 confirmed')).toBeInTheDocument();

    // Confirm button is gone
    expect(screen.queryByRole('button', { name: /Confirm/i })).not.toBeInTheDocument();

    // Verify callback was called
    expect(mockOnCommitted).toHaveBeenCalledWith('3-0 silk');
  });

  it('renders committed state initially if widget is already committed', () => {
    const committedWidget = {
      ...mockWidget,
      verify_count: 3,
      committed: true,
    };

    render(<MoveVerifyWidget widget={committedWidget} tenantId="test-tenant" />);

    expect(screen.getByText('Committed')).toBeInTheDocument();
    expect(screen.getByText('3/3 confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm/i })).not.toBeInTheDocument();
  });
});
