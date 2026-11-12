import { GunPad } from './GunPad';

const root = document.querySelector<HTMLDivElement>('#gun-app');
if (!root) throw new Error('#gun-app missing');
new GunPad(root);
