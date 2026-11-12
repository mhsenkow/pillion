import { STEP_DT } from '../core/constants';
import type { BikeRig } from '../art/bikeBuilder';
import type { ZombieEntity } from '../core/types';

export class SteppedAnimator {
  private lastStep = 0;
  frame = 0;
  playing = true;
  hz = 12;
  pose: 'idle' | 'drift_left' | 'drift_right' | 'fire' | 'turret' | 'lunge' = 'idle';

  maybeStep(now: number, bikeRig: BikeRig | null, zombies: ZombieEntity[], lean: number, aimRel: number): void {
    const dt = 1 / this.hz;
    if (!this.playing) return;
    if (now - this.lastStep < dt) return;
    this.lastStep = now;
    this.frame++;
    this.apply(bikeRig, zombies, lean, aimRel);
  }

  stepOnce(bikeRig: BikeRig | null, zombies: ZombieEntity[], lean: number, aimRel: number, dir = 1): void {
    this.frame += dir;
    this.apply(bikeRig, zombies, lean, aimRel);
  }

  private apply(bikeRig: BikeRig | null, zombies: ZombieEntity[], lean: number, aimRel: number): void {
    if (bikeRig) {
      let aim = aimRel;
      let leanAmt = lean * 0.18;
      if (this.pose === 'drift_left') leanAmt = 0.35;
      if (this.pose === 'drift_right') leanAmt = -0.35;
      if (this.pose === 'fire') {
        bikeRig.rider1.leftArm.rotation.x = -0.9 + Math.sin(this.frame) * 0.08;
        bikeRig.rider2.rightArm.rotation.x = -0.7;
      }
      if (this.pose === 'turret') aim = this.frame * 0.35;

      bikeRig.rider2.root.rotation.y = aim;
      bikeRig.rider1.root.rotation.z = -leanAmt;

      if (bikeRig.rider1.scarf) {
        bikeRig.rider1.scarf.children.forEach((seg, i) => {
          seg.position.x = 0.16 + Math.sin(this.frame * 0.9 + i) * 0.06;
          seg.position.y = 0.95 - i * 0.03 + Math.cos(this.frame * 0.8 + i) * 0.04;
        });
      }
      // Beanie bob
      if (bikeRig.rider2.parts.beanie) {
        bikeRig.rider2.parts.beanie.position.y = 0.28 + Math.sin(this.frame * 0.5) * 0.01;
      }
    }

    for (const z of zombies) {
      const phase = z.phase + (this.pose === 'lunge' ? this.frame * 0.4 : 0);
      const amp =
        this.pose === 'lunge' ? 0.35 : z.kind === 'runner' ? 0.28 : z.kind === 'clamberer' ? 0.32 : 0.22;
      const rate = z.kind === 'runner' ? 1.15 : z.kind === 'mutant' ? 0.7 : 0.85;
      z.steppedY = Math.abs(Math.sin(this.frame * rate + phase)) * amp;
      z.steppedRotZ = Math.cos(this.frame * rate + phase) * (z.kind === 'mutant' ? 0.22 : 0.16);
      if (z.kind === 'clamberer') {
        z.mesh.scale.y = 1 + Math.sin(this.frame * 0.6 + phase) * 0.04;
      }
    }
  }

  resetClock(now: number): void {
    this.lastStep = now;
  }
}

export { STEP_DT };
