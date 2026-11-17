/** Gamepad API driver seat: stick steer, triggers throttle, rumble on hits. */

export interface GamepadDrive {
  steer: number;
  throttle: number;
  brake: number;
  connected: boolean;
}

export function sampleGamepad(): GamepadDrive {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = pads.find((p) => p && p.connected);
  if (!pad) return { steer: 0, throttle: 0, brake: 0, connected: false };
  const steer = Math.abs(pad.axes[0] || 0) > 0.12 ? pad.axes[0] : 0;
  const throttle = pad.buttons[7]?.value ?? 0;
  const brake = pad.buttons[6]?.value ?? 0;
  return { steer, throttle, brake, connected: true };
}

export function rumbleGamepad(durationMs = 120, weak = 0.4, strong = 0.7): void {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    const vib = (pad as Gamepad & { vibrationActuator?: { playEffect: Function } }).vibrationActuator;
    void vib?.playEffect?.('dual-rumble', {
      startDelay: 0,
      duration: durationMs,
      weakMagnitude: weak,
      strongMagnitude: strong,
    });
  }
}
