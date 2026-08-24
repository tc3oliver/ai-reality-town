/**
 * The camera's six §17 events, derived from a mode transition (FR-Q007 / ART-140 AC#1).
 *
 * The reason these are derived from before-and-after rather than attached to each control is a
 * counting one, and the tests that matter here are the double-counting ones: returning to the
 * town view also turns follow off, so a "return" button and a follow toggle each emitting their
 * own event would report two interactions for one press — and PRD 2.0 §18.1's click-rate would
 * be inflated by exactly the amount nobody would think to check.
 */

import {
  ANALYTICS_TOWN_TARGET_ID,
  emitCameraEvents,
  type CameraTransitionMode,
} from './cameraEvents';
import { resetAnalyticsSink, setAnalyticsSink } from './analyticsSink';
import type { DynamicViewEvent } from './dynamicViewEvents';

const WORLD = 'mistwood';
const AT_REST: CameraTransitionMode = { follow: true, focusId: null, zoomStep: 0 };

let received: DynamicViewEvent[];

beforeEach(() => {
  received = [];
  setAnalyticsSink((event) => received.push(event));
});
afterEach(resetAnalyticsSink);

const names = () => received.map((event) => event.name);

function transition(next: Partial<CameraTransitionMode>, from: CameraTransitionMode = AT_REST) {
  emitCameraEvents(from, { ...from, ...next }, WORLD);
}

describe('each camera change emits its own event, once', () => {
  test('turning follow off, and on again', () => {
    // Two events, and both are right. With follow ON and no explicit focus the camera sits on
    // the PRIMARY SCENE, so switching follow off genuinely moves it to the town view — the
    // viewer did return to the town, they just did it with the other control. Suppressing the
    // second would under-count returns to make one test read more tidily.
    transition({ follow: false });
    expect(names()).toEqual(['live_camera_follow_disabled', 'live_return_to_town']);

    received = [];
    transition({ follow: true }, { ...AT_REST, follow: false });
    expect(names()).toEqual(['live_camera_follow_enabled']);
  });

  test('zooming carries the step, which is an index and not a pixel dimension', () => {
    transition({ zoomStep: 2 });
    expect(received).toEqual([
      { name: 'live_zoom_used', payload: { worldId: WORLD, zoomStep: 2 } },
    ]);
  });

  test('focusing a character', () => {
    transition({ focusId: 'character:he-jun' });
    expect(received).toEqual([
      { name: 'live_character_selected', payload: { worldId: WORLD, characterId: 'he-jun' } },
    ]);
  });

  test('focusing a scene', () => {
    transition({ focusId: 'scene:7:evening:mistwood-mill' });
    expect(received).toEqual([
      {
        name: 'live_scene_selected',
        // The full colon-bearing scene id survives intact — it is one identifier, not three.
        payload: { worldId: WORLD, sceneId: '7:evening:mistwood-mill' },
      },
    ]);
  });

  test('returning to the town view', () => {
    // What 「回到全鎮視角」 actually produces. `TOWN_TARGET_ID` never reaches a camera mode —
    // `CameraControls` maps it to `focusId: null` first — so detecting the town by that id
    // would have meant the event never fired at all. The DOM test caught exactly that.
    transition(
      { focusId: null, follow: false },
      { ...AT_REST, focusId: 'character:he-jun', follow: false },
    );
    expect(names()).toEqual(['live_return_to_town']);
  });
});

describe('what must NOT be counted', () => {
  test('a no-op transition emits nothing', () => {
    emitCameraEvents(AT_REST, { ...AT_REST }, WORLD);
    expect(received).toEqual([]);
  });

  test('pressing "return to town" while already there emits nothing', () => {
    // Otherwise the metric is a button-press counter rather than a navigation one.
    const atTown: CameraTransitionMode = { follow: false, focusId: null, zoomStep: 0 };
    emitCameraEvents(atTown, { ...atTown }, WORLD);
    expect(received).toEqual([]);
  });

  test('turning follow ON clears the focus but is not a return to town', () => {
    // It sends the camera to the primary SCENE. Treating a cleared focus as a return would
    // count this, and the two are different places.
    transition({ follow: true, focusId: null }, { ...AT_REST, follow: false, focusId: 'character:he-jun' });
    expect(names()).toEqual(['live_camera_follow_enabled']);
  });

  test('returning to town emits the follow change and the return, and no selection', () => {
    // The specific double-count this design exists to prevent: 「回到全鎮視角」 turns follow off
    // AND clears the focus, so a control-attached scheme would report two interactions for one
    // press and inflate section 18.1's click-rate by an amount nobody would think to check.
    transition({ focusId: null, follow: false }, { ...AT_REST, focusId: 'scene:s1' });
    expect(names()).toEqual(['live_camera_follow_disabled', 'live_return_to_town']);
    expect(names()).not.toContain('live_scene_selected');
  });

  test('clearing the focus while still following emits nothing', () => {
    // Leaving a target is not selecting one, and with follow still on the camera has not gone
    // to the town view either.
    transition({ focusId: null }, { ...AT_REST, focusId: 'character:he-jun' });
    expect(received).toEqual([]);
  });

  test('an unrecognised focus namespace emits nothing rather than guessing', () => {
    // A focus kind added later is silently uncounted, which is the safe direction: inventing an
    // event name for it would put an unreviewed schema into the stream.
    transition({ focusId: 'location:mistwood-mill' });
    expect(received).toEqual([]);
  });
});

describe('one press can legitimately be two changes', () => {
  test('focusing a character while turning follow off emits both, and only both', () => {
    // This is real: choosing a character in the camera controls also stops auto-follow. Two
    // things genuinely happened, and only one of them is an interaction for §18.1.
    transition({ follow: false, focusId: 'character:pei-lan' });
    expect(names()).toEqual(['live_camera_follow_disabled', 'live_character_selected']);
  });

  test('zoom and focus together emit exactly two', () => {
    transition({ zoomStep: 3, focusId: 'scene:s1' });
    expect(names()).toEqual(['live_zoom_used', 'live_scene_selected']);
  });
});

describe('payloads stay clean here too', () => {
  test('no camera event carries anything beyond the world and the thing focused', () => {
    transition({ follow: false, zoomStep: 1, focusId: 'character:he-jun' });
    for (const event of received) {
      for (const key of Object.keys(event.payload)) {
        expect(['worldId', 'zoomStep', 'characterId', 'sceneId']).toContain(key);
      }
    }
  });
});
