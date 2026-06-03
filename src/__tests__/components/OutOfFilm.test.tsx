import { render, screen } from '@testing-library/react';
import { OutOfFilm } from '@/components/OutOfFilm';

describe('OutOfFilm', () => {
  it('renders out-of-film message', () => {
    render(<OutOfFilm />);
    expect(screen.getByText(/out of film/i)).toBeInTheDocument();
    expect(screen.getByText(/thanks for capturing/i)).toBeInTheDocument();
  });
});
