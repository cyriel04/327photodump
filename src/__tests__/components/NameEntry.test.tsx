import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameEntry } from '@/components/NameEntry';
import { MAX_GUEST_NAME_LENGTH } from '@/lib/upload-limits';

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

  it('limits the name to the length the API accepts', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/name/i);
    expect(input).toHaveAttribute('maxLength', String(MAX_GUEST_NAME_LENGTH));

    await userEvent.type(input, 'a'.repeat(MAX_GUEST_NAME_LENGTH + 10));
    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledWith('a'.repeat(MAX_GUEST_NAME_LENGTH));
  });
});
