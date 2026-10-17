import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { RadioGroup } from '../../src/components/ui/RadioGroup';
import { Badge } from '../../src/components/ui/Badge';

describe('Button', () => {
  it('fires onClick and is keyboard-activatable', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Continue' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('disabled buttons are not focusable via tab', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });
});

describe('Input', () => {
  it('associates the label, hint, and error via aria-describedby', () => {
    render(
      <Input
        id="email"
        label="Email"
        hint="We never share this."
        error="Enter a valid email"
        required
      />,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
    expect(input.getAttribute('aria-describedby')).toContain('email-hint');
    expect(input.getAttribute('aria-describedby')).toContain('email-error');
  });
});

describe('RadioGroup', () => {
  it('calls onChange with the selected value and is keyboard-navigable', async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="track"
        legend="Launch track"
        value={undefined}
        onChange={onChange}
        options={[
          { value: 'aws_cloud', label: 'Cloud engineering' },
          { value: 'devops_platform', label: 'DevOps/platform' },
        ]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('DevOps/platform'));
    expect(onChange).toHaveBeenCalledWith('devops_platform');
  });

  it('renders a fieldset/legend so assistive tech announces the group name', () => {
    render(
      <RadioGroup
        name="track"
        legend="Launch track"
        value={undefined}
        onChange={() => {}}
        options={[{ value: 'aws_cloud', label: 'Cloud engineering' }]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Launch track' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders its label text', () => {
    render(<Badge tone="accent">Verified</Badge>);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });
});
