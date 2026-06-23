const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== Multer (图片上传) ======
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只支持图片'));
  }
});

// ====== 药品知识库 ======
const DRUGS_DB = require('./data/drugs.json');

// ====== MCP Tools ======

// Tool 1: identify_drug（通过文字查询 + OCR模拟）
app.post('/api/tool/identify_drug', async (req, res) => {
  const { query, image_base64 } = req.body;

  // 如果有图片，走OCR流程（模拟）
  if (image_base64) {
    return res.json({
      tool: 'identify_drug',
      call_id: `call_${Date.now()}`,
      status: 'success',
      result: {
        method: 'ocr',
        message: '图片已收到，正在识别药品信息...',
        note: '生产环境接入OCR API（如百度AI/腾讯云OCR）后自动识别药盒文字'
      }
    });
  }

  // 文字查询
  const matched = Object.entries(DRUGS_DB).find(([key, drug]) =>
    key.includes(query) || drug.aliases.some(a => a.includes(query))
  );

  if (!matched) {
    return res.json({
      tool: 'identify_drug',
      call_id: `call_${Date.now()}`,
      status: 'not_found',
      result: { found: false, suggestion: '请输入药品通用名或商品名，或拍摄药盒照片' }
    });
  }

  res.json({
    tool: 'identify_drug',
    call_id: `call_${Date.now()}`,
    status: 'success',
    result: { found: true, drug_key: matched[0], ...matched[1] }
  });
});

// Tool 2: query_drug_info
app.post('/api/tool/query_drug_info', (req, res) => {
  const { drug_name, simplify_level = 'simple' } = req.body;
  const drug = DRUGS_DB[drug_name];

  if (!drug) {
    return res.status(404).json({ tool: 'query_drug_info', status: 'error', message: `未找到: ${drug_name}` });
  }

  res.json({
    tool: 'query_drug_info',
    call_id: `call_${Date.now()}`,
    status: 'success',
    result: {
      name: drug.aliases[0],
      generic_name: drug.name,
      category: drug.category,
      dosage: simplify_level === 'simple' ? drug.dosage_simple : drug.dosage_detailed,
      when_to_take: drug.schedule,
      precautions: drug.precautions,
      side_effects: drug.side_effects,
      contraindications: drug.contraindications
    }
  });
});

// Tool 3: check_interaction
app.post('/api/tool/check_interaction', (req, res) => {
  const { drug_list, user_conditions = [] } = req.body;
  if (!drug_list || drug_list.length < 2) {
    return res.status(400).json({ tool: 'check_interaction', status: 'error', message: '至少选择2种药物' });
  }

  const results = [];
  for (let i = 0; i < drug_list.length; i++) {
    for (let j = i + 1; j < drug_list.length; j++) {
      const d1 = DRUGS_DB[drug_list[i]];
      const d2 = DRUGS_DB[drug_list[j]];
      if (!d1 || !d2) {
        results.push({ pair: `${drug_list[i]} + ${drug_list[j]}`, level: 'unknown', desc: '数据库暂未收录' });
        continue;
      }
      const interaction = d1.interactions?.[drug_list[j]] || d2.interactions?.[drug_list[i]];
      if (interaction) {
        results.push({
          pair: `${drug_list[i]} + ${drug_list[j]}`,
          level: interaction.level,
          desc: interaction.description,
          recommendation: interaction.recommendation
        });
      } else {
        results.push({ pair: `${drug_list[i]} + ${drug_list[j]}`, level: 'safe', desc: '未发现明显相互作用' });
      }
    }
  }

  res.json({
    tool: 'check_interaction',
    call_id: `call_${Date.now()}`,
    status: 'success',
    result: { pair_count: results.length, interactions: results }
  });
});

// Tool 4: translate_to_elderly
app.post('/api/tool/translate_to_elderly', (req, res) => {
  const { text } = req.body;
  const glossary = {
    '综合征': '一组症状', '代谢动力学': '药物在身体里的代谢过程',
    '半衰期': '药物效力持续的时间', '禁忌症': '不能吃的情况',
    '不良反应': '副作用', '副作用': '吃了可能不舒服',
    '空腹': '饭前至少1小时', '剂量': '吃多少',
  };
  let translated = text;
  for (const [k, v] of Object.entries(glossary)) {
    translated = translated.replace(new RegExp(k, 'g'), v);
  }
  res.json({ tool: 'translate_to_elderly', call_id: `call_${Date.now()}`, status: 'success', result: { original: text, translated } });
});

// Tool 5: detect_emergency
app.post('/api/tool/detect_emergency', (req, res) => {
  const { symptoms, medications = [] } = req.body;
  const emergency = ['胸痛', '呼吸困难', '意识模糊', '昏迷', '呕血', '黑便'];
  const urgent = ['剧烈头痛', '严重头晕', '无法站立', '全身无力'];
  const detected = { emergency: symptoms.filter(s => emergency.some(e => s.includes(e))), urgent: symptoms.filter(s => urgent.some(u => s.includes(u))) };

  let risk = 'safe';
  if (detected.emergency.length > 0) risk = 'emergency';
  else if (detected.urgent.length > 0) risk = 'urgent';

  res.json({
    tool: 'detect_emergency',
    call_id: `call_${Date.now()}`,
    status: 'success',
    result: {
      risk_level: risk,
      detected_symptoms: detected,
      recommendation: risk === 'emergency' ? '立即拨打120' : risk === 'urgent' ? '立即联系医生' : '继续观察'
    }
  });
});

// Tool 6: notify_contact
app.post('/api/tool/notify_contact', (req, res) => {
  const { contact_type, message, urgency = 'normal' } = req.body;
  console.log(`[通知] ${contact_type} | ${urgency} | ${message}`);
  res.json({ tool: 'notify_contact', call_id: `call_${Date.now()}`, status: 'success', result: { sent: true, channels: ['wechat', 'sms'] } });
});

// Tool 7: save_medication_plan
app.post('/api/tool/save_medication_plan', (req, res) => {
  const { drugs, reminder_times } = req.body;
  const plan = { id: `plan_${Date.now()}`, drugs, reminder_times, created_at: new Date().toISOString() };
  res.json({ tool: 'save_medication_plan', call_id: `call_${Date.now()}`, status: 'success', result: plan });
});

// ====== MCP Session（记录工具调用链） ======
app.post('/api/mcp/session', (req, res) => {
  const { user_query, tool_calls = [] } = req.body;
  const session = {
    session_id: `sess_${Date.now()}`,
    user_query,
    timestamp: new Date().toISOString(),
    protocol: 'MCP v3.8',
    agent: "药's话 v1.0",
    tool_calls,
    status: 'completed'
  };
  res.json(session);
});

// ====== Agent 对话接口 ======
app.post('/api/chat', (req, res) => {
  const { message, user_id, context = [] } = req.body;

  // 简单的意图识别
  const lower = message.toLowerCase();

  // 检查紧急情况
  const emergencyCheck = require('./utils/emergency_check');
  // ... 后续扩展

  // 匹配药品
  let matchedDrug = null;
  for (const [key, drug] of Object.entries(DRUGS_DB)) {
    if (lower.includes(key) || drug.aliases.some(a => lower.includes(a))) {
      matchedDrug = { key, ...drug };
      break;
    }
  }

  if (matchedDrug) {
    return res.json({
      type: 'drug_info',
      reply: `${matchedDrug.aliases[0]}，${matchedDrug.dosage_simple}${matchedDrug.schedule}`,
      drug: matchedDrug,
      suggestion: '需要我帮您看看和其他药的相互作用吗？'
    });
  }

  // 默认回复
  res.json({
    type: 'general',
    reply: '您可以问我任何关于用药的问题，或者拍一下药盒让我帮您看看。'
  });
});

// ====== Health ======
app.get('/api/health', (req, res) => {
  res.json({
    service: "药's话 AI Agent",
    status: 'healthy',
    mcp: 'v3.8',
    tools: 7,
    drugs: Object.keys(DRUGS_DB).length,
    uptime: process.uptime()
  });
});

// Start
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════╗
║      药's话 API Server              ║
║      http://localhost:${PORT}          ║
║      MCP Tools: 7  |  Drugs: ${Object.keys(DRUGS_DB).length}     ║
╚════════════════════════════════════╝
    `);
  });
}
module.exports = app;
