
#pragma vscode_glsllint_stage : frag 

precision highp float;

varying vec2 vUv;
varying vec2 vSceneUv;
varying vec2 vWorldX;
varying vec2 vWorldY;

uniform vec4 uAdjacency;
uniform vec4 uDiagonalAdjacency;
uniform vec4 uBroken;
uniform vec3 uBaseColor;
uniform vec4 uSkin;
uniform vec4 uPreviewRange;
uniform vec4 uCornerRadius;
uniform vec4 uNormalPreview;
uniform vec4 uSdfStrength;
uniform vec4 uSdfDebug;
uniform vec4 uAlbedoDarkness;
uniform vec4 uTransparency;
uniform vec4 uFinalAlpha;
uniform vec4 uLight;
uniform vec4 uNormalEnabled;
uniform vec4 uBevelWidth;
uniform vec4 uBevelHardness;
uniform vec4 uSpecularEnabled;
uniform vec4 uMetallic;
uniform vec4 uSmoothness;
uniform vec4 uSpecularTint;
uniform vec4 uSpecularPower;
uniform vec4 uEdgeTone;
uniform vec4 uEdgeWidth;
uniform vec4 uSelfEdgeTone;
uniform vec4 uSelfEdgeWidth;
uniform vec4 uBrokenEdgeTone;
uniform vec4 uBrokenEdgeWidth;
uniform vec4 uBrokenEdgeOffset;
uniform vec4 uBrokenDistortion;
uniform vec4 uBrokenNoiseScale;
uniform vec4 uBrokenSdfBlend;
uniform vec4 uReflectionEnabled;
uniform vec4 uReflectionOffset;
uniform vec4 uReflectionDownsample;
uniform vec4 uSceneSize;
uniform sampler2D uReflectionTexture;
uniform sampler2D uBevelProfile;
uniform sampler2D uTransparencyCurve;
uniform sampler2D uFinalAlphaCurve;
uniform sampler2D uMetallicCurve;
uniform sampler2D uNoiseTexture;

const float INF = 1e6;

void chooseNearest(
  inout float best,
  inout vec2 direction,
  float candidate,
  vec2 candidateDirection
) {
  if (candidate < best) {
    best = candidate;
    direction = candidateDirection;
  }
}

void addSegment(
  vec2 p,
  vec2 a,
  vec2 b,
  inout float best,
  inout vec2 direction
) {
  vec2 ab = b - a;
  float ab2 = max(dot(ab, ab), 1e-8);
  float t = clamp(dot(p - a, ab) / ab2, 0.0, 1.0);

  vec2 q = a + ab * t;
  vec2 delta = p - q;
  float dist = length(delta);

  vec2 dir;

  if (dist > 1e-6) {
    dir = delta / dist;
  } else {
    dir = normalize(vec2(-ab.y, ab.x));
  }

  chooseNearest(best, direction, dist, dir);
}

void addQuarterArc(
  vec2 p,
  vec2 center,
  float radius,
  vec2 quadrant,
  inout float best,
  inout vec2 direction
) {
  vec2 q = p - center;

  if (q.x * quadrant.x >= 0.0 &&
      q.y * quadrant.y >= 0.0) {

    float lenQ = length(q);

    if (lenQ > 1e-6) {
      // This is an inside-positive arc field. It reaches zero at the rounded
      // boundary and remains negative outside, rather than rising again.
      vec2 dir = -q / lenQ;

      chooseNearest(
        best,
        direction,
        radius - lenQ,
        dir
      );
    } else {
      chooseNearest(
        best,
        direction,
        radius,
        -normalize(quadrant)
      );
    }
  }
}

void main(void) {
  // Source adjacency is immutable. Broken sides deliberately do not alter
  // A1 or A2: both SDFs must still describe the original connected piece.
  bool l = uAdjacency.x > 0.5;
  bool r = uAdjacency.y > 0.5;
  bool u = uAdjacency.z > 0.5;
  bool d = uAdjacency.w > 0.5;

  bool tl = uDiagonalAdjacency.x > 0.5;
  bool tr = uDiagonalAdjacency.y > 0.5;
  bool br = uDiagonalAdjacency.z > 0.5;
  bool bl = uDiagonalAdjacency.w > 0.5;

  vec2 p = vUv * 2.0 - 1.0;

  float radius = clamp(uCornerRadius.x, 0.0, 1.0);

  /*
   * ================================================================
   * A1
   * Individual mino only.
   *
   * Adjacency has NO effect on the shape itself.
   * It only chooses the radius of each of this mino's four corners.
   *
   * A corner becomes tight when anything occupies the corresponding
   * neighboring corner of the grid:
   *
   *        TL
   *     X  |  X
   *        |
   *
   * Direct neighbors matter because they touch the two sides meeting
   * at this corner.
   *
   * Diagonal neighbors matter independently because they occupy the
   * corner diagonally, which is needed for configurations such as:
   *
   *       . X X
   *       X Z .
   *
   * Full radius is retained only when the corner is completely open.
   */

  const float TIGHT_RADIUS = 0.16;

  float rTL = (l || u || tl)
    ? radius * TIGHT_RADIUS
    : radius;

  float rTR = (r || u || tr)
    ? radius * TIGHT_RADIUS
    : radius;

  float rBR = (r || d || br)
    ? radius * TIGHT_RADIUS
    : radius;

  float rBL = (l || d || bl)
    ? radius * TIGHT_RADIUS
    : radius;

  float a1 = INF;
  vec2 a1Direction = vec2(0.0, -1.0);

  /*
   * Top side.
   */
  addSegment(
    p,
    vec2(-1.0 + rTL, -1.0),
    vec2( 1.0 - rTR, -1.0),
    a1,
    a1Direction
  );

  /*
   * Right side.
   */
  addSegment(
    p,
    vec2(1.0, -1.0 + rTR),
    vec2(1.0,  1.0 - rBR),
    a1,
    a1Direction
  );

  /*
   * Bottom side.
   */
  addSegment(
    p,
    vec2( 1.0 - rBR, 1.0),
    vec2(-1.0 + rBL, 1.0),
    a1,
    a1Direction
  );

  /*
   * Left side.
   */
  addSegment(
    p,
    vec2(-1.0,  1.0 - rBL),
    vec2(-1.0, -1.0 + rTL),
    a1,
    a1Direction
  );

  /*
   * Top-left rounded corner.
   */
  if (rTL > 0.0) {
    addQuarterArc(
      p,
      vec2(-1.0 + rTL, -1.0 + rTL),
      rTL,
      vec2(-1.0, -1.0),
      a1,
      a1Direction
    );
  }

  /*
   * Top-right rounded corner.
   */
  if (rTR > 0.0) {
    addQuarterArc(
      p,
      vec2(1.0 - rTR, -1.0 + rTR),
      rTR,
      vec2(1.0, -1.0),
      a1,
      a1Direction
    );
  }

  /*
   * Bottom-right rounded corner.
   */
  if (rBR > 0.0) {
    addQuarterArc(
      p,
      vec2(1.0 - rBR, 1.0 - rBR),
      rBR,
      vec2(1.0, 1.0),
      a1,
      a1Direction
    );
  }

  /*
   * Bottom-left rounded corner.
   */
  if (rBL > 0.0) {
    addQuarterArc(
      p,
      vec2(-1.0 + rBL, 1.0 - rBL),
      rBL,
      vec2(-1.0, 1.0),
      a1,
      a1Direction
    );
  }



  /*
   * ================================================================
   * A2
   * Connected polyomino boundary.
   * ================================================================
   */

  float a2 = INF;
  vec2 a2Direction = vec2(0.0, -1.0);

  bool convexTL = !l && !u;
  bool convexTR = !r && !u;
  bool convexBR = !r && !d;
  bool convexBL = !l && !d;

  /*
   * Exposed sides.
   *
   * Only convex corners consume part of an exposed side.
   */

  if (!u) {
    float insetLeft = convexTL ? radius : 0.0;
    float insetRight = convexTR ? radius : 0.0;

    addSegment(
      p,
      vec2(-1.0 + insetLeft, -1.0),
      vec2( 1.0 - insetRight, -1.0),
      a2,
      a2Direction
    );
  }

  if (!r) {
    float insetTop = convexTR ? radius : 0.0;
    float insetBottom = convexBR ? radius : 0.0;

    addSegment(
      p,
      vec2(1.0, -1.0 + insetTop),
      vec2(1.0,  1.0 - insetBottom),
      a2,
      a2Direction
    );
  }

  if (!d) {
    float insetRight = convexBR ? radius : 0.0;
    float insetLeft = convexBL ? radius : 0.0;

    addSegment(
      p,
      vec2( 1.0 - insetRight, 1.0),
      vec2(-1.0 + insetLeft,  1.0),
      a2,
      a2Direction
    );
  }

  if (!l) {
    float insetBottom = convexBL ? radius : 0.0;
    float insetTop = convexTL ? radius : 0.0;

    addSegment(
      p,
      vec2(-1.0,  1.0 - insetBottom),
      vec2(-1.0, -1.0 + insetTop),
      a2,
      a2Direction
    );
  }

  /*
   * Convex corners.
   */

  if (convexTL && radius > 0.0) {
    addQuarterArc(
      p,
      vec2(-1.0 + radius, -1.0 + radius),
      radius,
      vec2(-1.0, -1.0),
      a2,
      a2Direction
    );
  }

  if (convexTR && radius > 0.0) {
    addQuarterArc(
      p,
      vec2(1.0 - radius, -1.0 + radius),
      radius,
      vec2(1.0, -1.0),
      a2,
      a2Direction
    );
  }

  if (convexBR && radius > 0.0) {
    addQuarterArc(
      p,
      vec2(1.0 - radius, 1.0 - radius),
      radius,
      vec2(1.0, 1.0),
      a2,
      a2Direction
    );
  }

  if (convexBL && radius > 0.0) {
    addQuarterArc(
      p,
      vec2(-1.0 + radius, 1.0 - radius),
      radius,
      vec2(-1.0, 1.0),
      a2,
      a2Direction
    );
  }


  /*
   * Concave corners.
   *
   * These are distance-to-vertex features in the local mino.
   * The actual rounded concave boundary belongs to the neighboring
   * minos, so no displaced arc is introduced here.
   */

  if (l && u && !tl) {
    vec2 q = p - vec2(-1.0, -1.0);
    float dist = length(q);

    chooseNearest(
      a2,
      a2Direction,
      dist,
      dist > 1e-6 ? q / dist : vec2(-0.7071)
    );
  }

  if (r && u && !tr) {
    vec2 q = p - vec2(1.0, -1.0);
    float dist = length(q);

    chooseNearest(
      a2,
      a2Direction,
      dist,
      dist > 1e-6 ? q / dist : vec2(0.7071, -0.7071)
    );
  }

  if (r && d && !br) {
    vec2 q = p - vec2(1.0, 1.0);
    float dist = length(q);

    chooseNearest(
      a2,
      a2Direction,
      dist,
      dist > 1e-6 ? q / dist : vec2(0.7071)
    );
  }

  if (l && d && !bl) {
    vec2 q = p - vec2(-1.0, 1.0);
    float dist = length(q);

    chooseNearest(
      a2,
      a2Direction,
      dist,
      dist > 1e-6 ? q / dist : vec2(-0.7071, 0.7071)
    );
  }


  /*
   * ================================================================
   * A1 / A2 blend
   * ================================================================
   */

  float blend = clamp(uSkin.x, 0.0, 1.0);

  float distanceField = mix(
    a1,
    a2,
    blend
  );

  vec2 direction = mix(
    a1Direction,
    a2Direction,
    blend
  );

  /*
   * Broken sides are authored by fracture logic, not inferred from current
   * adjacency. A separate post-SDF field starts at zero on the recorded
   * broken side and rises inward over Broken Edge Width. Noise warps only
   * that field; it never changes the source A1/A2 connectivity.
   */
  float brokenEdgeDistance = INF;
  vec2 brokenDirection = direction;
  if (uBroken.x > 0.5 && vUv.x < brokenEdgeDistance) {
    brokenEdgeDistance = vUv.x;
    brokenDirection = vec2(1.0, 0.0);
  }
  if (uBroken.y > 0.5 && 1.0 - vUv.x < brokenEdgeDistance) {
    brokenEdgeDistance = 1.0 - vUv.x;
    brokenDirection = vec2(-1.0, 0.0);
  }
  if (uBroken.z > 0.5 && vUv.y < brokenEdgeDistance) {
    brokenEdgeDistance = vUv.y;
    brokenDirection = vec2(0.0, 1.0);
  }
  if (uBroken.w > 0.5 && 1.0 - vUv.y < brokenEdgeDistance) {
    brokenEdgeDistance = 1.0 - vUv.y;
    brokenDirection = vec2(0.0, -1.0);
  }
  float brokenEdgeWidth = max(uBrokenEdgeWidth.x, 0.0001);
  // Positive offset moves the fracture boundary inward before all broken
  // effects, including noise distortion and the direct silhouette cutout.
  float brokenField = brokenEdgeDistance - max(uBrokenEdgeOffset.x, 0.0);
  float brokenEdgeMask = 1.0 - smoothstep(0.0, brokenEdgeWidth, max(brokenField, 0.0));
  if (uBrokenDistortion.x > 0.0001 && brokenEdgeMask > 0.0) {
    float noise = texture2D(uNoiseTexture, vSceneUv * max(uBrokenNoiseScale.x, 0.001)).r * 2.0 - 1.0;
    brokenField -= noise * uBrokenDistortion.x * brokenEdgeWidth;
  }
  brokenEdgeMask = 1.0 - smoothstep(0.0, brokenEdgeWidth, max(brokenField, 0.0));

  // Broken SDF Blend selects the border source for fractured material:
  // Zero leaves every SDF-derived material effect untouched. One selects A1
  // as the fractured border source. Its influence stays local to the noisy
  // Broken Edge Width falloff, leaving the rest of the mino unchanged.
  if (brokenEdgeDistance < INF * 0.5) {
    float brokenControl = clamp(uBrokenSdfBlend.x, 0.0, 1.0);
    float brokenSourceField = mix(distanceField, a1, brokenControl);
    vec2 brokenSourceDirection = mix(direction, a1Direction, brokenControl);
    float fracturedField = min(brokenSourceField, brokenField);
    vec2 fracturedDirection = brokenField <= brokenSourceField ? brokenDirection : brokenSourceDirection;
    float brokenInfluence = brokenEdgeMask * brokenControl;
    distanceField = mix(distanceField, fracturedField, brokenInfluence);
    direction = mix(direction, fracturedDirection, brokenInfluence);
  }

  float directionLength = length(direction);

  if (directionLength > 1e-6) {
    direction /= directionLength;
  } else {
    direction = vec2(0.0, -1.0);
  }

  // Debug uses the signed result directly. Exterior samples are intentionally
  // retained and painted red so field errors remain visible.
  if (uSdfDebug.x > 0.5) {
    float debugField = clamp(0.5 + distanceField / max(uPreviewRange.x, 0.0001), 0.0, 1.0);
    gl_FragColor = distanceField < 0.0 ? vec4(1.0, 0.05, 0.05, 1.0) : vec4(vec3(debugField), 1.0);
    return;
  }

  // Fracture silhouette is independent of Broken SDF Blend. The blend changes
  // how the surviving material responds, while this dedicated field always
  // cuts the same noise-distorted contour from a flagged broken side.
  if (brokenEdgeDistance < INF * 0.5 && brokenField <= 0.0) discard;

  /*
   * ================================================================
   * Preview
   * ================================================================
   */

  float range = max(
    uPreviewRange.x,
    0.0001
  );

  // Alpha is independent of normal/material shaping. Only its own response
  // curves and scalar multipliers are allowed to change transparency.
  float alphaDistance = clamp(distanceField, 0.0, 1.0);

  // SDF strength and bevel controls are material inputs only. Bevel width is
  // the inward distance over which the height profile runs; beyond it the
  // profile is fully high and the normal becomes neutral.
  float shapedDistance = distanceField * uSdfStrength.x;
  float field = clamp(
    shapedDistance / range,
    0.0,
    1.0
  );

  float bevelT = pow(clamp(shapedDistance / max(uBevelWidth.x, 0.0001), 0.0, 1.0), max(uBevelHardness.x, 0.001));
  float bevel = texture2D(uBevelProfile, vec2(bevelT, 0.5)).r;
  // Direction is the inward distance gradient for both line and arc features.
  vec3 tangentNormal = normalize(vec3(-direction * (1.0 - bevel), 1.0));
  tangentNormal = normalize(mix(vec3(0.0, 0.0, 1.0), tangentNormal, uNormalEnabled.x));
  vec3 normal = normalize(vec3(vWorldX * tangentNormal.x + vWorldY * tangentNormal.y, tangentNormal.z));
  vec3 light = normalize(uLight.xyz);
  float diffuse = max(dot(normal, light), 0.0);
  vec3 albedo = uBaseColor * (1.0 - uAlbedoDarkness.x) * (0.18 + diffuse * 0.82);
  float edgeMask = 1.0 - smoothstep(0.0, max(uEdgeWidth.x, 0.0001), max(distanceField, 0.0));
  float selfEdgeMask = 1.0 - smoothstep(0.0, max(uSelfEdgeWidth.x, 0.0001), max(a1, 0.0));
  albedo *= max(0.0, 1.0 + uEdgeTone.x * edgeMask + uSelfEdgeTone.x * selfEdgeMask + uBrokenEdgeTone.x * brokenEdgeMask);
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(light + view);
  float specularExponent = mix(1.0, max(1.0, uSpecularPower.x), uSmoothness.x);
  float shine = pow(max(dot(normal, halfVector), 0.0), specularExponent);
  vec3 specularColor = mix(vec3(1.0), uBaseColor, uSpecularTint.x);
  float metallic = texture2D(uMetallicCurve, vec2(bevelT, 0.5)).r * uMetallic.x;
  vec3 specular = specularColor * shine * uSpecularEnabled.x * mix(0.25, 1.0, metallic);
  vec2 reflectionUv = vec2(vSceneUv.x + uReflectionOffset.x / uSceneSize.x, 1.0 - vSceneUv.y + uReflectionOffset.y / uSceneSize.y);
  vec3 reflection = texture2D(uReflectionTexture, reflectionUv).rgb;
  specular += reflection * uReflectionEnabled.x * (0.15 + metallic * 0.85);
  float transparency = texture2D(uTransparencyCurve, vec2(alphaDistance, 0.5)).r * uTransparency.x;
  float finalAlpha = texture2D(uFinalAlphaCurve, vec2(alphaDistance, 0.5)).r * uFinalAlpha.x;
  if (distanceField <= 0.0) discard;
  float alpha = clamp(transparency * finalAlpha, 0.0, 1.0);
  if (alpha <= 0.001) discard;
  if (uNormalPreview.x > 0.5) albedo = normal * 0.5 + 0.5;
  gl_FragColor = vec4((albedo + specular) * alpha, alpha);
}
