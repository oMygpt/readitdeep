文本向量化 API
最近更新时间：2025.09.17 16:23:13
首次发布时间：2025.04.10 20:43:38

复制全文
我的收藏
有用
无用
POST https://ark.cn-beijing.volces.com/api/v3/embeddings    运行​
当您需通过语义来处理文本，如语义检索、分析词性等，可以调用向量化服务，将文本转化为向量，来分析文本的语义关系。本文为您提供服务接口的参数详细说明供您查阅。​
如果您需要调整向量维度，请参考 向量降维。​
​
快速入口
鉴权说明
本接口支持 API Key 鉴权，详见鉴权认证方式。
如需使用 Access Key 来鉴权，推荐使用 SDK 的方式，具体请参见 SDK概述。
​
 模型列表       模型计费       API Key​
 接口文档       常见问题      开通模型​
​
​
​
请求参数 ​
跳转 响应参数​
请求体​
​
​
model string 必选​
您需要调用的模型的 ID （Model ID），开通模型服务，并查询 Model ID 。​
您也可通过 Endpoint ID 来调用模型，获得限流、计费类型（前付费/后付费）、运行状态查询、监控、安全等高级能力，可参考获取 Endpoint ID。​
​
​
input string / string[] 必选​
需要向量化的内容列表，支持中文、英文。输入内容需满足下面条件：​
不得超过模型的最大输入 token 数。doubao-embdding 模型，每个列表元素（并非单次请求总数）最大输入token 数为 4096。​
不能为空列表，列表的每个成员不能为空字符串。​
单条文本以 utf-8 编码，长度不超过 100,000 字节。​
为获得更好性能，建议文本数量总token不超过4096，或者文本条数不超过4。​
​
​
encoding_format string / null  默认值 float​
取值范围： float、base64、null。​
embedding 返回的格式。​
​
​
​
响应参数​
跳转 请求参数​
​
​
id string​
本次请求的唯一标识 。​
​
​
model string​
本次请求实际使用的模型名称和版本。​
​
​
created integer​
本次请求创建时间的 Unix 时间戳（秒）。​
​
​
object string​
固定为 list。​
​
​
data object​
本次请求的算法输出内容。​
属性​
​
​
data.index integer​
向量的序号，与请求参数 input 列表中的内容顺序对应。​
​
​
data.embedding float[]​
对应内容的向量化结果。​
​
​
data.object string​
固定为 embedding。​
​
​
​
usage object​
本次请求的 token 用量。​
属性​
​
​
usage.prompt_tokens integer​
输入内容 token 数量。​
​
​
usage.total_tokens integer​
本次请求消耗的总 token 数量（输入 + 输出）。​


import os

from volcenginesdkarkruntime import Ark


client = Ark(api_key=os.environ.get("ARK_API_KEY"))

resp = client.embeddings.create(
    model="doubao-embedding-text-240715",
    input=[
        " 天很蓝",
        "海很深",
    ],
    encoding_format="float",
)
print(resp)