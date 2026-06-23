module.exports = {
  checkEmergency(symptoms) {
    const emergency = ['胸痛', '呼吸困难', '意识模糊', '昏迷', '呕血', '黑便', '剧烈头痛'];
    const urgent = ['严重头晕', '无法站立', '全身无力', '意识不清'];
    const hits = { emergency: symptoms.filter(s => emergency.some(e => s.includes(e))), urgent: symptoms.filter(s => urgent.some(u => s.includes(u))) };
    return { risk: hits.emergency.length ? 'emergency' : hits.urgent.length ? 'urgent' : 'safe', hits };
  }
};
