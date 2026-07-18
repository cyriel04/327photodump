import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Gallery } from '@/components/Gallery';

jest.mock('@/components/MyShotsGrid', () => ({
  MyShotsGrid: ({ guestName }: { guestName: string }) => <div>MyShotsGrid for {guestName}</div>,
}));
jest.mock('@/components/FeedScreen', () => ({
  FeedScreen: () => <div>FeedScreen</div>,
}));

describe('Gallery', () => {
  it('renders the out-of-film message', () => {
    render(<Gallery guestName="Cyriel" />);
    expect(screen.getByText(/out of film/i)).toBeInTheDocument();
  });

  it('shows My Shots by default', () => {
    render(<Gallery guestName="Cyriel" />);
    expect(screen.getByText(/MyShotsGrid for Cyriel/)).toBeInTheDocument();
  });

  it('switches to Feed when the Feed tab is tapped', async () => {
    render(<Gallery guestName="Cyriel" />);
    await userEvent.click(screen.getByRole('button', { name: 'Feed' }));
    expect(screen.getByText('FeedScreen')).toBeInTheDocument();
  });
});
