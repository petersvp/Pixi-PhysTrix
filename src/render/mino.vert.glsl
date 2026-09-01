#pragma vscode_glsllint_stage : vert

precision highp float;
attribute vec2 aPosition;
attribute vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
varying vec2 vUv;
varying vec2 vSceneUv;
varying vec2 vWorldX;
varying vec2 vWorldY;
uniform vec4 uSceneSize;
void main(void) {
  vUv = aUV;
  mat3 worldMatrix = uWorldTransformMatrix * uTransformMatrix;
  vec3 position = uProjectionMatrix * worldMatrix * vec3(aPosition, 1.0);
  vec3 scenePosition = worldMatrix * vec3(aPosition, 1.0);
  vSceneUv = scenePosition.xy / uSceneSize.xy;
  vWorldX = normalize(worldMatrix[0].xy);
  vWorldY = normalize(worldMatrix[1].xy);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
