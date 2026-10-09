import type { MapCamera } from "./map-camera";
/** One fullscreen GPU pass; local water mask texture, no particle DOM or network resources. */
export const WEATHER_FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time,rain,snow,wind,direction,gust,cloud,fog,night,golden,motion,storm,cameraX,cameraY,cameraScale,viewportWidth,viewportHeight;
uniform sampler2D waterMask;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float n=0.;float a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(5.2,1.3);a*=.5;}return n;}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;vec2 aspect=vec2(resolution.x/resolution.y,1.);
 float t=time*motion; vec2 breeze=vec2(sin(direction),cos(direction));
 float turbulence=sin(t*.7)*gust*.12;vec2 p=uv*aspect;
 vec2 world=(vec2(cameraX,cameraY)+(uv-vec2(.5))*vec2(viewportWidth,-viewportHeight)/max(cameraScale,1.))*1800.;
 float clouds=fbm(world+breeze*t*(.006+wind*.028));
 float shadow=smoothstep(.35,.78,clouds)*cloud*.19;
 float mist=fbm(p*2.2+vec2(t*.012,0.));float haze=fog*(.13+mist*.35);
 vec3 tint=mix(vec3(.18,.27,.34),vec3(.95,.65,.31),golden);
 float shade=night*.30+shadow;vec3 color=mix(tint,vec3(.83,.87,.83),haze/(shade+haze+.001));float alpha=shade+haze;
 float solar=pow(max(0.,1.-length((uv-vec2(.1,.88))*vec2(.7,1.))),3.)*(1.-cloud)*(1.-night)*.08;
 color=mix(color,vec3(1.,.84,.52),solar/(alpha+solar+.001));alpha+=solar;
 float drops=0.,flakes=0.;
 for(int i=0;i<3;i++){
  float depth=float(i)+1.;vec2 q=p*vec2(85.,15.)/depth;
  q.x+=(breeze.x*wind*.6+turbulence)*q.y;
  q.y+=t*(12.+rain*15.)/depth;
  vec2 cell=floor(q),f=fract(q);float seed=hash(cell);
  float streak=(1.-smoothstep(.025,.07,abs(f.x-.5)))*(1.-smoothstep(.2,.8,abs(f.y-.5)));
  drops+=streak*step(1.-rain*.24,seed)*(.24+depth*.08);
  vec2 s=p*(65./depth);s+=breeze*t*wind*.6;s.y+=t*(.6+depth*.22);s.x+=sin(s.y*.3+t)*(.15+wind*.5);
  vec2 sc=floor(s),sf=fract(s)-.5;float radius=.045+depth*.018;
  flakes+=(1.-smoothstep(radius*.5,radius,length(sf)))*step(1.-snow*.35,hash(sc))*.55;
 }
 // Water-only rings: geographic polygon mask comes from the actual rendered map.
 float water=texture2D(waterMask,vec2(uv.x,1.-uv.y)).r;
 vec2 rippleCell=p*vec2(22.,35.);vec2 rippleFloor=floor(rippleCell);vec2 ripplePoint=fract(rippleCell)-.5;
 float rippleAge=fract(t*.55+hash(rippleFloor));
 float ring=(1.-smoothstep(.015,.045,abs(length(ripplePoint*vec2(1.,1.6))-rippleAge*.48)))*(1.-rippleAge);
 float ripples=water*rain*ring*.22*motion;
 float precipitation=clamp(drops+flakes+ripples,0.,.7);
 color=mix(color,vec3(.93,.97,1.),precipitation/(alpha+precipitation+.001));alpha+=precipitation;
 // Broad, infrequent storm illumination with a soft 1.8s envelope; never rapid flashing.
 float cycle=mod(t,29.);float illumination=exp(-pow((cycle-18.)/0.9,2.))*storm*motion*.14;
 color=mix(color,vec3(.83,.88,1.),illumination/(alpha+illumination+.001));alpha+=illumination;
 // Wind travels through precipitation and cloud density, never as UI-like lines.
 gl_FragColor=vec4(color,clamp(alpha,0.,.62));
}`;
export function createAtmosphereRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw Error("Atmosphere shader unavailable");
    }
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}",
  );
  const fragment = compile(gl.FRAGMENT_SHADER, WEATHER_FRAGMENT),
    program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const location = (key: string) => {
    if (!uniforms.has(key))
      uniforms.set(key, gl.getUniformLocation(program, key));
    return uniforms.get(key)!;
  };
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  gl.uniform1i(location("waterMask"), 0);
  const mask = document.createElement("canvas"),
    maskContext = mask.getContext("2d");
  return {
    setCamera(camera: MapCamera) {
      if (!maskContext) return;
      mask.width = Math.max(1, Math.round(camera.width * 0.5));
      mask.height = Math.max(1, Math.round(camera.height * 0.5));
      maskContext.fillStyle = "black";
      maskContext.fillRect(0, 0, mask.width, mask.height);
      maskContext.fillStyle = "white";
      maskContext.scale(0.5, 0.5);
      for (const polygon of camera.water) {
        maskContext.beginPath();
        for (const ring of polygon) {
          ring.forEach(([x, y], i) => {
            if (i === 0) maskContext.moveTo(x, y);
            else maskContext.lineTo(x, y);
          });
          maskContext.closePath();
        }
        maskContext.fill("evenodd");
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    },
    draw(values: Record<string, number>, scale: number) {
      const width = Math.max(1, Math.round(canvas.clientWidth * scale)),
        height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(location("resolution"), width, height);
      for (const [key, value] of Object.entries(values))
        gl.uniform1f(location(key), value);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
