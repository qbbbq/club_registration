import { FetchClient, Config } from 'coze-coding-dev-sdk';

async function fetchDocument() {
  const url = 'https://coze-coding-project.tos.coze.site/create_attachment/2026-03-14/2464426470678615_b1befc98efd62e95c9c8f8900ec9aac0_README-95468d5f26.docx?sign=4895526649-1efb286c8b-0-0264114863ee70720b03a196f25c3836a0f773744d2ecc17eb661bdf8fa03fac';
  
  const config = new Config();
  const client = new FetchClient(config);
  
  console.log('正在获取文档内容...');
  const response = await client.fetch(url);
  
  console.log('\n文档标题:', response.title);
  console.log('文档ID:', response.doc_id);
  console.log('文件类型:', response.filetype);
  console.log('状态:', response.status_code === 0 ? '成功' : '失败');
  
  console.log('\n===== 文档内容 =====\n');
  
  for (const item of response.content) {
    if (item.type === 'text') {
      console.log(item.text);
    }
  }
}

fetchDocument().catch(console.error);
