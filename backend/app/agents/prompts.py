"""
Read it DEEP - 内容分析 Prompt 版本管理

支持功能:
- 版本化管理所有 Agent Prompt
- 支持迭代和 A/B 测试
- 记录 Prompt 变更历史
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
from enum import Enum


class PromptType(Enum):
    """Prompt 类型"""
    SUMMARY = "summary"
    METHOD = "method"
    DATASET = "dataset"
    CODE = "code"


@dataclass
class PromptVersion:
    """Prompt 版本定义"""
    version: str  # e.g., "v1.0.0"
    prompt_type: PromptType
    system_prompt: str
    user_prompt_template: str  # 使用 {content} 作为占位符
    description: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    is_active: bool = True


# =============================================================================
# Summary Agent Prompts
# =============================================================================

SUMMARY_V1_0_0 = PromptVersion(
    version="v1.0.0",
    prompt_type=PromptType.SUMMARY,
    system_prompt="你是一个学术论文分析专家。",
    user_prompt_template="""请分析以下论文内容，生成一个简洁的中文摘要（200-300字）。

摘要应包含：
1. 研究问题/目标
2. 主要方法/贡献
3. 关键发现/结论

论文内容：
{content}

请直接输出摘要文本，不需要 JSON 格式。""",
    description="初始版本 - 基础摘要提取",
)

SUMMARY_V1_1_0 = PromptVersion(
    version="v1.1.0",
    prompt_type=PromptType.SUMMARY,
    system_prompt="你是一个资深学术论文分析专家，擅长提炼论文核心贡献。",
    user_prompt_template="""请分析以下学术论文内容，生成一个结构化的中文摘要（250-350字）。

## 摘要要求
请按以下结构组织内容：

**研究背景**：1-2句话说明研究问题和动机
**核心方法**：描述主要技术方法或理论框架
**主要贡献**：列出1-3个核心贡献点
**实验验证**：简述实验设置和关键结果
**主要结论**：1-2句话总结研究意义

## 论文内容
{content}

请直接输出摘要文本，使用自然段落形式（不要使用上述模板标题）。""",
    description="结构化摘要 - 更详细的分析框架",
)


# =============================================================================
# Method Agent Prompts
# =============================================================================

METHOD_V1_0_0 = PromptVersion(
    version="v1.0.0",
    prompt_type=PromptType.METHOD,
    system_prompt="你是一个学术论文方法提取专家。请以 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，提取所有研究方法。

对于每个方法，返回：
- name: 方法名称
- description: 方法描述（2-3句话）
- location: 该方法在文中的位置（引用原文片段，20-50字）

论文内容：
{content}

以 JSON 格式返回：
```json
{{
  "methods": [
    {{"name": "方法名", "description": "描述", "location": "原文片段"}}
  ]
}}
```""",
    description="初始版本 - 基础方法提取",
)

METHOD_V1_1_0 = PromptVersion(
    version="v1.1.0",
    prompt_type=PromptType.METHOD,
    system_prompt="你是一个深度学习和机器学习论文方法分析专家。请以结构化 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，精确提取所有研究方法和技术细节。

## 提取要求
请识别以下类型的方法：
1. **核心算法**：论文提出的主要算法或模型
2. **基线方法**：对比实验中使用的基线
3. **评估方法**：评测指标和验证流程
4. **数据处理**：预处理、增强等技术

对于每个方法，返回：
- name: 方法名称（使用原文术语）
- category: 类别（core/baseline/evaluation/preprocessing）
- description: 方法描述（2-3句话，包含技术细节）
- location: 该方法在文中的位置（引用原文片段，20-50字）

## 论文内容
{content}

## 输出格式
```json
{{
  "methods": [
    {{
      "name": "方法名",
      "category": "core",
      "description": "描述",
      "location": "原文片段"
    }}
  ]
}}
```""",
    description="增强方法分类 - 区分核心方法、基线、评估方法等",
)


# =============================================================================
# Dataset Agent Prompts
# =============================================================================

DATASET_V1_0_0 = PromptVersion(
    version="v1.0.0",
    prompt_type=PromptType.DATASET,
    system_prompt="你是一个学术论文数据集识别专家。请以 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，识别所有提到的数据集。

对于每个数据集，返回：
- name: 数据集名称
- url: 数据集链接（如有）
- description: 数据集描述
- location: 在文中的位置（引用原文片段）

论文内容：
{content}

以 JSON 格式返回：
```json
{{
  "datasets": [
    {{"name": "数据集名", "url": "链接", "description": "描述", "location": "原文片段"}}
  ]
}}
```

如果没有找到数据集，返回空数组。""",
    description="初始版本 - 基础数据集识别",
)

DATASET_V1_1_0 = PromptVersion(
    version="v1.1.0",
    prompt_type=PromptType.DATASET,
    system_prompt="你是一个机器学习数据集和基准测试专家。请以 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，全面识别所有提及的数据集和基准测试（Benchmark）。

## 识别范围
1. **训练数据集**：用于模型训练的数据
2. **测试/验证集**：用于评估的数据
3. **基准测试**：标准化的评测基准（如 GLUE, ImageNet, COCO 等）
4. **自建数据集**：论文作者创建或收集的数据

## 输出字段
- name: 数据集名称（使用标准名称）
- type: 类型（train/test/benchmark/custom）
- url: 数据集链接（如有，包括 HuggingFace、GitHub 等）
- size: 数据规模（如有提及）
- description: 数据集描述
- location: 在文中的位置（引用原文片段）

## 论文内容
{content}

## 输出格式
```json
{{
  "datasets": [
    {{
      "name": "数据集名",
      "type": "benchmark",
      "url": "链接",
      "size": "100K samples",
      "description": "描述",
      "location": "原文片段"
    }}
  ]
}}
```

如果没有找到数据集，返回空数组。""",
    description="增强数据集分类 - 区分训练集、测试集、基准等",
)


# =============================================================================
# Code Agent Prompts
# =============================================================================

CODE_V1_0_0 = PromptVersion(
    version="v1.0.0",
    prompt_type=PromptType.CODE,
    system_prompt="你是一个学术论文代码引用识别专家。请以 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，提取所有代码仓库引用。

查找：
- GitHub/GitLab 链接
- 代码开源声明
- 实现相关的引用

对于每个代码引用，返回：
- repo_url: 仓库链接
- description: 代码描述
- location: 在文中的位置（引用原文片段）

论文内容：
{content}

以 JSON 格式返回：
```json
{{
  "code_refs": [
    {{"repo_url": "链接", "description": "描述", "location": "原文片段"}}
  ]
}}
```

如果没有找到代码引用，返回空数组。""",
    description="初始版本 - 基础代码引用提取",
)

CODE_V1_1_0 = PromptVersion(
    version="v1.1.0",
    prompt_type=PromptType.CODE,
    system_prompt="你是一个开源代码和可复现研究专家。请以 JSON 格式返回结果。",
    user_prompt_template="""分析以下论文内容，全面提取所有代码和实现相关的资源。

## 查找范围
1. **官方代码仓库**：论文作者发布的代码
2. **参考实现**：引用的第三方实现
3. **依赖框架**：使用的深度学习框架（PyTorch, TensorFlow 等）
4. **预训练模型**：使用或发布的模型权重（HuggingFace, ModelScope 等）
5. **在线演示**：Demo、Colab Notebook 等

## 输出字段
- repo_url: 仓库/资源链接
- type: 类型（official/reference/framework/pretrained/demo）
- license: 开源协议（如有提及）
- description: 代码/资源描述
- location: 在文中的位置（引用原文片段）

## 论文内容
{content}

## 输出格式
```json
{{
  "code_refs": [
    {{
      "repo_url": "链接",
      "type": "official",
      "license": "MIT",
      "description": "描述",
      "location": "原文片段"
    }}
  ]
}}
```

如果没有找到代码引用，返回空数组。""",
    description="增强代码分类 - 区分官方代码、参考实现、预训练模型等",
)


# =============================================================================
# Prompt Registry - 版本管理中心
# =============================================================================

class PromptRegistry:
    """
    Prompt 版本注册中心
    
    支持:
    - 获取当前活跃版本
    - 按版本号获取特定版本
    - 列出所有版本
    - 切换活跃版本
    """
    
    # 所有版本的 Prompt
    _prompts: dict[str, list[PromptVersion]] = {
        PromptType.SUMMARY.value: [SUMMARY_V1_0_0, SUMMARY_V1_1_0],
        PromptType.METHOD.value: [METHOD_V1_0_0, METHOD_V1_1_0],
        PromptType.DATASET.value: [DATASET_V1_0_0, DATASET_V1_1_0],
        PromptType.CODE.value: [CODE_V1_0_0, CODE_V1_1_0],
    }
    
    # 当前活跃版本 (可通过环境变量或 API 切换)
    _active_versions: dict[str, str] = {
        PromptType.SUMMARY.value: "v1.0.0",
        PromptType.METHOD.value: "v1.0.0",
        PromptType.DATASET.value: "v1.0.0",
        PromptType.CODE.value: "v1.0.0",
    }
    
    @classmethod
    def get_active_prompt(cls, prompt_type: PromptType) -> PromptVersion:
        """获取指定类型的当前活跃 Prompt"""
        version = cls._active_versions.get(prompt_type.value, "v1.0.0")
        return cls.get_prompt(prompt_type, version)
    
    @classmethod
    def get_prompt(cls, prompt_type: PromptType, version: str) -> PromptVersion:
        """获取指定类型和版本的 Prompt"""
        prompts = cls._prompts.get(prompt_type.value, [])
        for p in prompts:
            if p.version == version:
                return p
        # 默认返回第一个版本
        if prompts:
            return prompts[0]
        raise ValueError(f"No prompt found for {prompt_type.value}")
    
    @classmethod
    def list_versions(cls, prompt_type: PromptType) -> list[dict]:
        """列出指定类型的所有版本"""
        prompts = cls._prompts.get(prompt_type.value, [])
        active_version = cls._active_versions.get(prompt_type.value)
        return [
            {
                "version": p.version,
                "description": p.description,
                "is_active": p.version == active_version,
                "created_at": p.created_at.isoformat(),
            }
            for p in prompts
        ]
    
    @classmethod
    def set_active_version(cls, prompt_type: PromptType, version: str) -> bool:
        """设置指定类型的活跃版本"""
        prompts = cls._prompts.get(prompt_type.value, [])
        if any(p.version == version for p in prompts):
            cls._active_versions[prompt_type.value] = version
            return True
        return False
    
    @classmethod
    def get_all_active_versions(cls) -> dict[str, str]:
        """获取所有类型的活跃版本"""
        return cls._active_versions.copy()


# 便捷函数
def get_summary_prompt() -> PromptVersion:
    return PromptRegistry.get_active_prompt(PromptType.SUMMARY)

def get_method_prompt() -> PromptVersion:
    return PromptRegistry.get_active_prompt(PromptType.METHOD)

def get_dataset_prompt() -> PromptVersion:
    return PromptRegistry.get_active_prompt(PromptType.DATASET)

def get_code_prompt() -> PromptVersion:
    return PromptRegistry.get_active_prompt(PromptType.CODE)
