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

  it('wires tabs to a labelled tabpanel', async () => {
    render(<Gallery guestName="Cyriel" />);
    const mine = screen.getByRole('tab', { name: 'My Shots' });
    const panel = screen.getByRole('tabpanel');
    expect(mine).toHaveAttribute('id');
    expect(mine).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', mine.id);
    expect(panel).toHaveAccessibleName('My Shots');

    const feed = screen.getByRole('tab', { name: 'Feed' });
    await userEvent.click(feed);
    const feedPanel = screen.getByRole('tabpanel');
    expect(feed).toHaveAttribute('aria-controls', feedPanel.id);
    expect(feedPanel).toHaveAccessibleName('Feed');
  });

  it('uses a roving tabIndex so only the selected tab is in the Tab order', async () => {
    render(<Gallery guestName="Cyriel" />);
    const mine = screen.getByRole('tab', { name: 'My Shots' });
    const feed = screen.getByRole('tab', { name: 'Feed' });
    expect(mine).toHaveAttribute('tabIndex', '0');
    expect(feed).toHaveAttribute('tabIndex', '-1');

    await userEvent.click(feed);
    expect(mine).toHaveAttribute('tabIndex', '-1');
    expect(feed).toHaveAttribute('tabIndex', '0');
  });

  it('switches tabs with ArrowRight / ArrowLeft and moves focus', async () => {
    render(<Gallery guestName="Cyriel" />);
    const mine = screen.getByRole('tab', { name: 'My Shots' });
    const feed = screen.getByRole('tab', { name: 'Feed' });
    mine.focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(feed).toHaveFocus();
    expect(feed).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('FeedScreen')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowLeft}');
    expect(mine).toHaveFocus();
    expect(mine).toHaveAttribute('aria-selected', 'true');

    // Wraps around at either end.
    await userEvent.keyboard('{ArrowLeft}');
    expect(feed).toHaveFocus();
  });
});
