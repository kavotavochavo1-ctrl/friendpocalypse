// in-game sprite sizes in view px (engine.md §7): display heights from the art scale (hero ≈ 128 px, the reference's ~110 ref px × 1.15)
(function () {
  const HT = { hasan_front: 134, hasan_side: 134, hasan_back: 134, leha_front: 128, leha_side: 128, leha_back: 128,
    danil_front: 122, danil_side: 122, danil_back: 122, vitya_front: 122, vitya_side: 122, vitya_back: 122,
    ghoul_front: 84, ghoul_side: 84, ghoul_back: 84, lamp: 290, bench: 96, pillar: 120, fence: 120, bush: 92, bin: 70,
    tree: 300, cypress: 290, autumn: 250, flowers: 80, statue: 260, gazebo: 400, pergola: 300,
    // Мелеуз: props, the town folk (heroes are ~128), the stray dogs
    mlamp: 300, bollard: 78, rail: 120, spruce: 330, thuja: 240,
    gopnik_front: 120, gopnik_side: 120, gopnik_back: 120, alkash_front: 112, alkash_side: 112, alkash_back: 112,
    mom_front: 124, mom_side: 124, mom_back: 124, dog_side0: 62, dog_side1: 62, dog_side2: 62, dog_front: 78, dog_back: 78, dog_alpha: 92 };
  // set pieces sized by world width instead (buildings, monuments, the bus)
  const WD = { admin: 1000, mosque: 640, church: 560, glory: 420, lenin: 200, tmonument: 300, bus_paz: 540, kiosk: 150 };
  const S = (window.SIZES = window.SIZES || {});
  for (const n in HT) { const a = window.ASSETS[n]; if (a) S[n] = [a.w * HT[n] / a.h, HT[n]]; }
  for (const n in WD) { const a = window.ASSETS[n]; if (a) S[n] = [WD[n], a.h * WD[n] / a.w]; }
})();
