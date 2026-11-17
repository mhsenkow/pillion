import { GunPad } from './GunPad';
import { installErrorReporting } from '../core/errorReporting';

installErrorReporting('gun');
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

const root = document.querySelector<HTMLDivElement>('#gun-app');
if (!root) throw new Error('#gun-app missing');
new GunPad(root);
