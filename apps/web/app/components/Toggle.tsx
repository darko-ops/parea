'use client';

/**
 * One switch: a label, a line saying what it does, and the control.
 *
 * A real `<button role="switch">` rather than a checkbox styled to look like
 * one. Both are announced correctly, but a switch is a thing that takes effect
 * when you flip it and a checkbox is a thing that takes effect when a form is
 * submitted — and on the manage screen these do the first. Same component in
 * both places so they cannot start behaving differently.
 *
 * The explanation is required rather than optional. Every one of these
 * switches decides who can see somebody's photographs, and a bare label that
 * says "Private" tells you the name of the setting rather than what happens.
 */

export function Toggle({
  label,
  help,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  help: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="toggle">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        <span className="toggle-help">{help}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={`toggle-switch${on ? ' is-on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}
