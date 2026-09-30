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
    await userEvent.click(screen.getByRole('tab', { name: 'Feed' }));
    expect(screen.getByText('FeedScreen')).toBeInTheDocument();
  });

  it('exposes the switcher as an accessible tablist with the selected tab marked', async () => {
    render(<Gallery guestName="Cyriel" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();

    const mine = screen.getByRole('tab', { name: 'My Shots' });
    const feed = screen.getByRole('tab', { name: 'Feed' });
    expect(mine).toHaveAttribute('aria-selected', 'true');
    expect(feed).toHaveAttribute('aria-selected', 'false');
    expect(mine).toHaveAttribute('type', 'button');
    expect(feed).toHaveAttribute('type', 'button');

    await userEvent.click(feed);
    expect(feed).toHaveAttribute('aria-selected', 'true');
    expect(mine).toHaveAttribute('aria-selected', 'false');
  });
});
