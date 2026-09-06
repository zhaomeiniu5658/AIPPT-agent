/**
 * PPTAgent API Integration
 * 前端通过本地后端适配层接入 PPTAgent
 */

import { request } from '@/utils/req'

const PPTAGENT_CONFIG = {
  proxyURL: '/api/pptagent',
}

function unwrapResponse(response) {
  return response?.data ?? response ?? {}
}

/**
 * Stage 1: 仅生成 PPT 大纲
 * @param {Object} params - 生成参数
 * @returns {Promise<Object>} 大纲生成结果
 */
export async function generateOutlineOnly(params) {
  const {
    keyword,
    model = 'DeepSeek V3',
    pageCount = '15 - 20页',
    textAmount = '详细',
    language = '简体中文',
    style = '大众',
  } = params

  try {
    console.log('[PPTAgent] Stage 1: 生成大纲:', params)

    const response = await request.post(`${PPTAGENT_CONFIG.proxyURL}/generate-outline-only`, {
      keyword,
      model,
      pageCount,
      textAmount,
      language,
      style,
    })

    const data = unwrapResponse(response)
    console.log('[PPTAgent] 大纲生成成功:', data)

    return {
      success: true,
      outline: data.outline || data.outline_text || data.content || '',
      title: data.title || data.ppt_title || keyword,
      logId: data.log_id || data.task_id || data.job_id || data.id,
      message: data.message || data.msg || '生成成功',
      raw: data,
    }
  } catch (error) {
    console.error('[PPTAgent] 大纲生成失败:', error)
    return {
      success: false,
      error: error.response?.data?.message || error.message || '生成失败，请重试',
    }
  }
}

/**
 * Stage 2: 根据大纲生成完整 PPT 结构
 * @param {Object} params - 生成参数
 * @returns {Promise<Object>} PPT 生成结果
 */
export async function generatePPTFromOutline(params) {
  const {
    outline,
    title,
    keyword = '',
    style = '大众',
  } = params

  try {
    console.log('[PPTAgent] Stage 2: 根据大纲生成 PPT:', { title, outlineLength: outline?.length })

    const response = await request.post(`${PPTAGENT_CONFIG.proxyURL}/generate-ppt`, {
      outline,
      title,
      keyword,
      style,
    })

    const data = unwrapResponse(response)
    console.log('[PPTAgent] PPT 生成成功:', data)

    return {
      success: true,
      formattedMarkdown: data.formatted_markdown || data.formattedMarkdown || data.markdown || '',
      title: data.title || title,
      message: data.message || data.msg || '生成成功',
      pptxUrl: data.pptx_url || data.download_url || data.file_url || '',
      raw: data,
    }
  } catch (error) {
    console.error('[PPTAgent] PPT 生成失败:', error)
    return {
      success: false,
      error: error.response?.data?.message || error.message || '生成失败，请重试',
    }
  }
}

/**
 * Legacy: 一步生成大纲和内容
 */
export async function generatePPTOutline(params) {
  const {
    keyword,
    model = 'DeepSeek V3',
    pageCount = '15 - 20页',
    textAmount = '详细',
    language = '简体中文',
    style = '大众',
  } = params

  try {
    console.log('[PPTAgent] 调用工作流生成 PPT:', params)

    const response = await request.post(`${PPTAGENT_CONFIG.proxyURL}/generate-outline`, {
      keyword,
      model,
      pageCount,
      textAmount,
      language,
      style,
    })

    const data = unwrapResponse(response)

    return {
      success: true,
      outline: data.outline || data.outline_text || '',
      formattedMarkdown: data.formatted_markdown || data.formattedMarkdown || data.markdown || '',
      title: data.title || keyword,
      logId: data.log_id || data.task_id || data.job_id || data.id,
      code: data.code || '',
      message: data.message || data.msg || '生成成功',
      raw: data,
    }
  } catch (error) {
    console.error('[PPTAgent] 工作流调用失败:', error)
    throw {
      success: false,
      error: error.message || '生成失败，请重试',
    }
  }
}

/**
 * 轮询检查工作流执行状态
 * @param {string} logId - 工作流 ID
 */
export async function pollWorkflowStatus(logId, maxAttempts = 30, interval = 2000) {
  let attempts = 0

  while (attempts < maxAttempts) {
    try {
      const response = await request.get(`${PPTAGENT_CONFIG.proxyURL}/workflow-status/${logId}`)
      const data = unwrapResponse(response)
      const status = data.status || data.state

      if (status === 'completed' || status === 'success') {
        return {
          success: true,
          data,
        }
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(data.error || data.message || '工作流执行失败')
      }

      await new Promise((resolve) => setTimeout(resolve, interval))
      attempts++
    } catch (error) {
      console.error('[PPTAgent] 状态轮询失败:', error)
      throw error
    }
  }

  throw new Error('工作流执行超时')
}

/**
 * 解析 Markdown 为 PPT 结构
 * @param {string} markdown
 */
export function parseMarkdownToSlides(markdown) {
  const slides = []
  const sections = String(markdown || '').split(/^# /gm).filter(Boolean)

  sections.forEach((section, index) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `Slide ${index + 1}`
    const content = []
    let currentLevel = null

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      if (line.startsWith('## ')) {
        content.push({
          type: 'subtitle',
          text: line.replace('## ', '').trim(),
        })
        currentLevel = 'subtitle'
      } else if (line.match(/^[-*]\s/)) {
        content.push({
          type: 'bullet',
          text: line.replace(/^[-*]\s/, '').trim(),
          level: currentLevel === 'subtitle' ? 2 : 1,
        })
      } else if (!line.startsWith('#')) {
        content.push({
          type: 'text',
          text: line,
        })
      }
    }

    slides.push({
      id: `slide-${index + 1}`,
      title,
      content,
      layout: determineLayout(content),
    })
  })

  return slides
}

function determineLayout(content) {
  if (content.length === 0) return 'title'

  const hasBullets = content.some((item) => item.type === 'bullet')
  const hasSubtitle = content.some((item) => item.type === 'subtitle')

  if (hasBullets && content.length > 5) return 'bullet-list'
  if (hasSubtitle) return 'section'

  return 'content'
}

/**
 * 将 PPTAgent 返回结果转换为 PPT 数据格式
 */
export function convertPptAgentToPPTData(pptResult) {
  const formattedMarkdown =
    pptResult.formattedMarkdown ||
    pptResult.formatted_markdown ||
    pptResult.markdown ||
    ''
  const title = pptResult.title || ''
  const slides = parseMarkdownToSlides(formattedMarkdown)

  return {
    title: title || slides[0]?.title || 'Untitled Presentation',
    slides,
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'pptagent-workflow',
      model: pptResult.model || 'DeepSeek V3',
    },
  }
}

/**
 * Stage 1 (Streaming): 流式生成 PPT 大纲
 * @param {Object} params - 生成参数
 * @param {Function} onMessage - 接收消息回调 (type, data) => void
 */
export async function generateOutlineStream(params, onMessage) {
  const {
    keyword,
    model = 'DeepSeek V3',
    pageCount = '15 - 20页',
    textAmount = '详细',
    language = '简体中文',
    style = '大众',
  } = params

  try {
    console.log('[PPTAgent Stream] Starting outline generation:', params)

    const queryParams = new URLSearchParams({
      keyword,
      model,
      pageCount,
      textAmount,
      language,
      style,
    })

    const url = `${PPTAGENT_CONFIG.proxyURL}/generate-outline-stream?${queryParams}`
    const eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('[PPTAgent Stream] Message:', data.type, data)

        onMessage?.(data.type, data)

        if (data.type === 'complete' || data.type === 'error') {
          eventSource.close()
        }
      } catch (error) {
        console.error('[PPTAgent Stream] Parse error:', error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('[PPTAgent Stream] Connection error:', error)
      eventSource.close()
      onMessage?.('error', { message: '连接中断' })
    }
  } catch (error) {
    console.error('[PPTAgent Stream] Failed:', error)
    onMessage?.('error', { message: error.message })
  }
}

export default {
  generatePPTOutline,
  pollWorkflowStatus,
  parseMarkdownToSlides,
  convertPptAgentToPPTData,
  generateOutlineStream,
  generateOutlineOnly,
  generatePPTFromOutline,
}
