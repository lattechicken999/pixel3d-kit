# pixel3d-kit

**3D를 손으로 찍은 도트처럼.** 이 Claude Code 플러그인은 실시간 3D 장면을 도트(픽셀아트) 게임처럼 보이게 만드는 기법 8가지를 모았습니다. 플러그인을 설치한 뒤 "도트풍으로 만들어줘"라고 하면, Claude가 프로젝트 엔진에 맞춰 기법을 적용하고 스크린샷으로 결과를 확인합니다.

*Make real-time 3D look like hand-drawn pixel art. This is a Claude Code plugin with a tested Three.js module, Godot and Unity recipes, and a skill that learns rendering techniques from videos.*

![왼쪽: 기법 끔 / 오른쪽: 8가지 기법 모두 켬](docs/before-after.png)

## 8가지 기법

해상도만 낮춰서는 도트 느낌이 나지 않고, 흐릿한 저해상도 3D가 될 뿐입니다. 아래 기법을 함께 써야 합니다.

| # | 기법 | 효과 |
|---|---|---|
| 1 | 저해상도 렌더 + 확대 시 보간 없음 | 픽셀이 생깁니다 |
| 2 | **1픽셀 외곽선** (깊이 차이로 검출) | 물체가 스프라이트처럼 또렷해집니다 |
| 3 | **안쪽 굴곡에도 선** (노멀 차이로 검출) | 손으로 그린 듯한 디테일이 생깁니다 |
| 4 | **계단식 명암** (정해 둔 색 단계, 팔레트) | 3D 특유의 부드러운 그라데이션이 사라집니다 |
| 5 | **빛 받는 방향 편집 + 그림자용 모양 따로** | 울퉁불퉁한 면 대신 깔끔한 덩어리 명암이 나옵니다 |
| 6 | **픽셀 격자 정렬** (카메라, 오브젝트, 관절, 파티클) | 움직일 때 픽셀이 떨리지 않습니다 |
| 7 | **각도를 띄엄띄엄** (8방향 회전) | 도트 그림 여러 장을 넘기는 것처럼 보입니다 |
| 8 | **겹치는 순서를 스프라이트처럼** | 벽에 붙어 서도 칼이 잘리지 않습니다 |

![기법 8: 왼쪽은 칼이 벽에 묻힘, 오른쪽은 온전히 보임](docs/sword-sorting.png)

## 설치

Claude Code에서 아래 두 명령을 차례로 실행하세요.

```
/plugin marketplace add lattechicken999/pixel3d-kit
```

```
/plugin install pixel3d-kit@pixel3d-kit
```

GitHub에 올리기 전에 로컬 폴더로 바로 시험하려면 다음을 실행하세요.

```bash
claude --plugin-dir ./pixel3d-kit
```

## 사용법

| 이렇게 하면 | 일어나는 일 |
|---|---|
| "이 게임 도트풍으로 바꿔줘" | `pixel-3d` 스킬이 자동으로 쓰입니다 |
| `/pixelize` | 지금 프로젝트에 기법을 적용합니다. `/pixelize three 4 1-6,8`처럼 엔진, 픽셀 크기, 적용할 기법을 지정할 수 있습니다 |
| `/pixel3d-new my-game 숲속 오두막` | 도트풍 3D 프로젝트를 새로 만듭니다 |
| 영상 파일이나 링크를 주고 "이거 학습해서 적용해줘" | `learn-from-video` 스킬이 프레임, 자막, 음성을 분석해 정리한 뒤 적용합니다 |

## 구성

```
.claude-plugin/          plugin.json, marketplace.json, icon
skills/pixel-3d/         SKILL.md, assets/threejs/pixel3d.js, references/{theory,godot,unity}.md
skills/learn-from-video/ SKILL.md, scripts/extract.sh  (ffmpeg, optional yt-dlp / Whisper)
commands/                /pixelize, /pixel3d-new
examples/threejs-demo/   기법마다 켜고 끌 수 있는 데모
```

### 데모 실행

저장소 폴더에서 아래 명령을 실행한 뒤 브라우저로 <http://localhost:8000/examples/threejs-demo/> 를 여세요.

```bash
python3 -m http.server 8000
```

- 이동: WASD 또는 방향키
- `?off=all` 또는 `?off=2,8`: 해당 기법을 끈 상태로 시작합니다
- `?t=1.3`: 시간을 멈춥니다 (스크린샷용)
- `?pose=wall`: 칼이 벽에 박힌 자세로 기법 8을 시험합니다

### Three.js API (요약)

```js
const pixel = new PixelRenderer(renderer, { pixelSize: 4 });     // 1, 2, 3, 6
const mat   = createToonMaterial({ color, steps: 3 });           // 4
sphericalizeNormals(geometry, 0.85); addShadowProxy(mesh, geo);  // 5
obj.userData.pixelSnap = true;                                   // 6
hero.rotation.y = quantizeAngle(facing, 8);                      // 7
const flat = flattenDepth(hero, { bias: 0.4 });                  // 8
pixel.render(scene, camera);
```

## 상태

- **Three.js 모듈:** headless Chromium(WebGL2)에서 렌더링하고, 기법을 켰을 때와 껐을 때의 스크린샷을 비교해 확인했습니다.
- **Godot / Unity 레시피:** 같은 수식으로 옮긴 코드지만 아직 각 에디터에서 실행해 보지 않았습니다. PR 환영합니다.

## 출처

- 기법은 [Gamit | 1분 게임 이야기](https://www.youtube.com/@gamit_log)의 쇼츠 「귀여운 도트 게임인줄 알았는데, 사실 전부 3D입니다」를 보고 정리했습니다. 이 쇼츠는 *Never's End* 개발진의 GDC 2026 발표를 소개합니다.
- 이 저장소는 그 영상과 게임의 아트나 에셋을 쓰지 않습니다. 기법만 직접 구현했습니다.
- 외곽선과 굴곡선 셰이더는 커뮤니티에 널리 알려진 3D 픽셀아트 렌더링 방식을 따릅니다.

## License

MIT
