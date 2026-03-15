// branding page which basically just renders a bunch of assets loaded from json encoded Thingtime ".tt" data files
// import from ./assets/all.ts = [{...},...]
import { Thingtime } from '~/components/Thingtime/Thingtime';
import Assets from './assets/all';

export default function Branding() {
  return (
    <div>
      <h1>Thingtime Branding Assets</h1>
      <Thingtime thing={Assets} />
    </div>
  );
}
