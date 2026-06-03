import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameEntry } from '@/components/NameEntry';

describe('NameEntry', () => {
  it('renders name input and start button', () => {
    render(<NameEntry onSubmit={jest.fn()} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed name when form is submitted', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/name/i), '  Cyriel  ');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledWith('Cyriel');
  });

  it('does not call onSubmit when name is empty', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
