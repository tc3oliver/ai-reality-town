import type { StaticMapModel } from './staticMapModel';

/**
 * The static floor plan (FR-O010 / ART-127, ladder rung 3).
 *
 * Drawn as SVG, so it is reachable in exactly the case it exists for: a browser that cannot
 * run WebGL, or one whose renderer already threw. See {@link ./staticMapModel} for why rung 3
 * is not "the Pixi stage, stopped".
 *
 * ## What is the accessible content here
 *
 * The plan is `aria-hidden` and the roster beside it is the real content, which is the same
 * decision `CharacterSprite` (ART-129) took and for the same reason: the roster already says
 * every fact the plan shows, in words, so announcing the plan too would announce the same
 * information twice. The plan is a rendering of the roster, not a second source.
 *
 * That also means this rung degrades honestly one more step on its own: with images or SVG
 * disabled, the roster is still a complete answer to "where is everyone".
 */
export function StaticMapView({ model }: { model: StaticMapModel }) {
  return (
    <div className="static-map">
      <svg
        className="static-map-plan"
        viewBox={`0 0 ${model.width} ${model.height}`}
        // Decorative: the roster below states every fact this draws. See the note above.
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        {model.rooms.map((room) => (
          <g key={room.id}>
            <rect
              className="static-map-room"
              x={room.x}
              y={room.y}
              width={room.width}
              height={room.height}
              rx={4}
            />
            <text className="static-map-room-name" x={room.x + 6} y={room.y + 18}>
              {room.name}
            </text>
          </g>
        ))}
        {model.occupants.map((occupant) => (
          <g key={occupant.characterId}>
            <circle
              className="static-map-occupant"
              cx={occupant.x}
              cy={occupant.y}
              r={7}
              data-character={occupant.characterId}
            />
            <text className="static-map-occupant-name" x={occupant.x + 11} y={occupant.y + 5}>
              {occupant.label}
            </text>
          </g>
        ))}
      </svg>

      {/* The accessible content, and the fallback for a client that draws no SVG at all. */}
      {model.roster.length > 0 ? (
        <ul className="public-rows static-map-roster" aria-label="最後已知位置">
          {model.roster.map((group) => (
            <li key={group.roomId ?? 'between'}>
              <span className="static-map-roster-room">{group.roomName}</span>
              <span>{group.occupants.map((occupant) => occupant.label).join('、')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="public-muted">目前沒有已知的角色位置。</p>
      )}
    </div>
  );
}
