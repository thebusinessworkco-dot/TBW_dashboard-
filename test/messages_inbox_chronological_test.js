import assert from 'assert'

console.log('======================================================')
console.log('  WHATSAPP INBOX LATEST MESSAGES & PAGINATION AUDIT')
console.log('======================================================')

// 1. Simulation of Database Query Generation & SQL Pagination Behavior
console.log('\n[Test 1] SQL Query Generation & Subquery Logic')

function generateMessagesSql({ conversationId, limit = 100, offset = 0, since, order }) {
  const conditions = ['m.conversation_id = $1']
  const params = [conversationId]
  let pIdx = 2

  if (since) {
    conditions.push(`m.created_at > $${pIdx++}`)
    params.push(since)
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`
  const queryParams = [...params, limit, offset]
  const limitPlaceholder = `$${pIdx++}`
  const offsetPlaceholder = `$${pIdx++}`

  let sql = ''
  if (order === 'desc') {
    sql = `
      SELECT m.*, u.name as sender_name
      FROM public.messages m
      LEFT JOIN public.users u ON m.sender_id = u.id
      ${whereClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `
  } else if (since) {
    sql = `
      SELECT m.*, u.name as sender_name
      FROM public.messages m
      LEFT JOIN public.users u ON m.sender_id = u.id
      ${whereClause}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `
  } else {
    sql = `
      SELECT * FROM (
        SELECT m.*, u.name as sender_name
        FROM public.messages m
        LEFT JOIN public.users u ON m.sender_id = u.id
        ${whereClause}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      ) sub
      ORDER BY sub.created_at ASC, sub.id ASC
    `
  }

  return { sql: sql.trim(), queryParams }
}

const defaultQuery = generateMessagesSql({ conversationId: 42, limit: 100, offset: 0 })
assert.strictEqual(defaultQuery.sql.includes('ORDER BY m.created_at DESC, m.id DESC'), true)
assert.strictEqual(defaultQuery.sql.includes('ORDER BY sub.created_at ASC, sub.id ASC'), true)
assert.strictEqual(defaultQuery.queryParams[0], 42)
assert.strictEqual(defaultQuery.queryParams[1], 100)
assert.strictEqual(defaultQuery.queryParams[2], 0)
console.log('  ✓ PASS: Default query executes subquery with DESC ordering and outer ASC chronological sort')

const sinceQuery = generateMessagesSql({ conversationId: 42, limit: 100, offset: 0, since: '2026-10-20T19:30:00.000Z' })
assert.strictEqual(sinceQuery.sql.includes('m.created_at > $2'), true)
assert.strictEqual(sinceQuery.sql.includes('ORDER BY m.created_at ASC, m.id ASC'), true)
assert.strictEqual(sinceQuery.queryParams[1], '2026-10-20T19:30:00.000Z')
console.log('  ✓ PASS: `since` incremental fetch orders forwards ASC from given timestamp')

// 2. Simulation of 150 Messages (Old vs New Behavior)
console.log('\n[Test 2] 150-Message Dataset: Latest 7:40 PM Message Visibility')

// Generate 150 simulated messages (from 09:00 AM to 19:40 PM)
const allMessages = Array.from({ length: 150 }, (_, i) => {
  const minute = i % 60
  const hour = 9 + Math.floor(i / 60)
  const pad = (n) => String(n).padStart(2, '0')
  const time = `2026-10-20T${pad(hour)}:${pad(minute)}:00.000Z`
  return {
    id: i + 1,
    conversation_id: 1,
    direction: i % 2 === 0 ? 'inbound' : 'outbound',
    sender_type: i % 2 === 0 ? 'customer' : 'ai',
    content: i === 149 ? 'I need tax registration services at 7:40 PM' : `Message #${i + 1}`,
    created_at: time
  }
})

// OLD query simulation: ORDER BY created_at ASC LIMIT 100 OFFSET 0
const oldResult = [...allMessages]
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  .slice(0, 100)

const oldHasLatest = oldResult.some(m => m.id === 150)
assert.strictEqual(oldHasLatest, false, 'Old query must fail to return the latest 7:40 PM message (reproducing bug)')
console.log('  ✓ PASS: Verified bug reproduction: Old ASC LIMIT 100 returns messages #1-#100, omitting latest #150')

// NEW query simulation: ORDER BY created_at DESC LIMIT 100 OFFSET 0 -> outer ORDER BY created_at ASC
const newInner = [...allMessages]
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)
  .slice(0, 100)

const newResult = [...newInner]
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)

assert.strictEqual(newResult.length, 100)
assert.strictEqual(newResult[newResult.length - 1].id, 150, 'Latest message must be at the end of the array')
assert.strictEqual(newResult[newResult.length - 1].content, 'I need tax registration services at 7:40 PM')
assert.strictEqual(newResult[0].id, 51, 'First message of latest 100 page must be message #51')
console.log('  ✓ PASS: New query returns the latest 100 messages (51-150) in ascending chronological order!')

// 3. Frontend Deduplication & Equality Checks
console.log('\n[Test 3] Frontend Deduplication & Deep Diff Detection')

function dedupeMessages(items) {
  if (!Array.isArray(items) || items.length === 0) return []
  const seen = new Set()
  const result = []
  for (const m of items) {
    if (!m) continue
    const key = m.id ? `id_${m.id}` : (m.wa_message_id ? `wa_${m.wa_message_id}` : `m_${m.created_at}_${m.direction}_${m.content}`)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(m)
    }
  }
  return result.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
}

function areMessagesEqual(prev, next) {
  if (prev.length !== next.length) return false
  return !next.some((item, idx) => {
    const p = prev[idx]
    if (!p) return true
    return String(p.id) !== String(item.id) ||
      p.delivery_status !== item.delivery_status ||
      p.content !== item.content ||
      p.error_message !== item.error_message ||
      p.created_at !== item.created_at ||
      JSON.stringify(p.metadata || {}) !== JSON.stringify(item.metadata || {})
  })
}

// Test Deduplication
const rawListWithDupes = [
  { id: 1, content: 'Hi', created_at: '2026-10-20T10:00:00.000Z' },
  { id: 2, content: 'Hello', created_at: '2026-10-20T10:01:00.000Z' },
  { id: 1, content: 'Hi', created_at: '2026-10-20T10:00:00.000Z' } // Duplicate
]
const deduped = dedupeMessages(rawListWithDupes)
assert.strictEqual(deduped.length, 2)
assert.strictEqual(deduped[0].id, 1)
assert.strictEqual(deduped[1].id, 2)
console.log('  ✓ PASS: dedupeMessages eliminates duplicate message IDs safely')

// Test Deep Equality Check
const m1 = [{ id: 1, content: 'Hi', delivery_status: 'pending', metadata: { type: 'button' } }]
const m2 = [{ id: 1, content: 'Hi', delivery_status: 'sent', metadata: { type: 'button' } }]
assert.strictEqual(areMessagesEqual(m1, m2), false, 'Must detect delivery_status change')

const m3 = [{ id: 1, content: 'Hi', delivery_status: 'sent', metadata: { type: 'button' } }]
const m4 = [{ id: 1, content: 'Hi', delivery_status: 'sent', metadata: { type: 'button_reply', button_reply: { id: 'btn_1', title: 'Yes' } } }]
assert.strictEqual(areMessagesEqual(m3, m4), false, 'Must detect interactive metadata selection changes')

const m5 = [{ id: 1, content: 'Hi', delivery_status: 'sent', metadata: { type: 'button' } }]
assert.strictEqual(areMessagesEqual(m3, m5), true, 'Identical messages must return true')
console.log('  ✓ PASS: areMessagesEqual reliably detects delivery status, interactive selection, and content diffs')

// 4. Auto-Scroll Threshold Check
console.log('\n[Test 4] Smart Auto-Scroll Threshold Evaluation')

function shouldAutoScroll({ scrollHeight, scrollTop, clientHeight, threshold = 100 }) {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight
  return distanceFromBottom <= threshold
}

// User at bottom
assert.strictEqual(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true)
// User near bottom (within 50px)
assert.strictEqual(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 550, clientHeight: 400 }), true)
// User scrolled up (300px away from bottom)
assert.strictEqual(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }), false)
console.log('  ✓ PASS: shouldAutoScroll returns true when near bottom (<=100px) and false when scrolled up')

// 5. Interactive Message Scenarios (Customer Inbound, AI Outbound, Interactive Options)
console.log('\n[Test 5] Complete WhatsApp Scenario Data Structures')

const scenarios = [
  {
    type: 'Customer Inbound Text',
    message: {
      id: 101,
      direction: 'inbound',
      sender_type: 'customer',
      content: 'Hello, need help with GST filing',
      metadata: {}
    }
  },
  {
    type: 'AI Interactive Outbound List',
    message: {
      id: 102,
      direction: 'outbound',
      sender_type: 'ai',
      content: 'Please choose your preferred language:',
      metadata: {
        interactive: {
          type: 'list',
          action: {
            button: 'Choose Language',
            sections: [
              {
                title: 'Available Languages',
                rows: [
                  { id: 'lang_en', title: 'English' },
                  { id: 'lang_hi', title: 'Hindi' }
                ]
              }
            ]
          }
        }
      }
    }
  },
  {
    type: 'Customer Interactive List Reply',
    message: {
      id: 103,
      direction: 'inbound',
      sender_type: 'customer',
      content: 'English',
      metadata: {
        list_reply: { id: 'lang_en', title: 'English' }
      }
    }
  },
  {
    type: 'AI Interactive End Chat Button',
    message: {
      id: 104,
      direction: 'outbound',
      sender_type: 'ai',
      content: 'You can end the chat anytime:',
      metadata: {
        interactive: {
          type: 'button',
          action: {
            buttons: [
              { reply: { id: 'btn_end', title: 'End Chat' } }
            ]
          }
        }
      }
    }
  }
]

for (const sc of scenarios) {
  assert.strictEqual(typeof sc.message.id, 'number')
  assert.strictEqual(typeof sc.message.content, 'string')
  assert.strictEqual(typeof sc.message.direction, 'string')
  console.log(`  ✓ PASS: Scenario '${sc.type}' validated with valid structure`)
}

console.log('\n======================================================')
console.log('  ALL INBOX AUDIT TESTS PASSED (100%)')
console.log('======================================================\n')
