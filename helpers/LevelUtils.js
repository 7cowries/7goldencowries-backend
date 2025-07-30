export function getLevelInfo(xp) {
  const levels = [
    { level: 1, name: 'Shell of Curiosity', xp: 0 },
    { level: 2, name: 'Cowrie Initiate', xp: 100 },
    { level: 3, name: 'Bronze Oracle', xp: 300 },
    { level: 4, name: 'Silver Teller', xp: 700 },
    { level: 5, name: 'Golden Seer', xp: 1500 },
    { level: 6, name: 'Cowrie Elder', xp: 3000 },
    { level: 7, name: 'Keeper of 7 Cowries', xp: 6000 }
  ];
  return levels.reverse().find(level => xp >= level.xp) || levels[0];
}

