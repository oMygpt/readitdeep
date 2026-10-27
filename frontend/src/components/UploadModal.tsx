/**
 * Read it DEEP - 上传弹窗
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, FileText, Loader2 } from 'lucide-react';
import { isLinkedMode, papersApi } from '../lib/api';
import { seriesApi, withPriceConfirm } from '../lib/series';
import BillingBadge from './BillingBadge';

interface UploadModalProps {
    onClose: () => void;
}

export default function UploadModal({ onClose }: UploadModalProps) {
    const [dragActive, setDragActive] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const queryClient = useQueryClient();

    const linked = isLinkedMode();
    const uploadMutation = useMutation({
        // 关联 PaperDaily：只收 PDF，按篇计费，报价需要确认时弹窗
        mutationFn: (file: File) => linked
            ? withPriceConfirm((price) => seriesApi.upload(file, price))
            : papersApi.upload(file),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['library'] });
            queryClient.invalidateQueries({ queryKey: ['billing-status'] });
            onClose();
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['library'] }),
    });

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setSelectedFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleUpload = () => {
        if (selectedFile) {
            uploadMutation.mutate(selectedFile);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-surface-elevated rounded-2xl border border-border w-full max-w-lg p-6 animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold">上传论文</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Drop Zone */}
                <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${dragActive
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-content-muted'
                        }`}
                >
                    {selectedFile ? (
                        <div className="flex flex-col items-center gap-3">
                            <FileText className="w-12 h-12 text-primary" />
                            <p className="font-medium">{selectedFile.name}</p>
                            <p className="text-sm text-content-muted">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                            <button
                                onClick={() => setSelectedFile(null)}
                                className="text-sm text-content-muted hover:text-content-main"
                            >
                                更换文件
                            </button>
                        </div>
                    ) : (
                        <>
                            <Upload className="w-12 h-12 text-content-muted mx-auto mb-4" />
                            <p className="text-content-dim mb-2">拖拽文件到此处，或点击选择</p>
                            <p className="text-sm text-content-muted">{linked ? '支持 PDF' : '支持 PDF、LaTeX、Word 格式'}</p>
                            <input
                                type="file"
                                accept={linked ? '.pdf,application/pdf' : '.pdf,.tex,.docx,.doc'}
                                onChange={handleFileSelect}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                        </>
                    )}
                </div>

                {/* Info */}
                <div className="mt-4 p-3 bg-surface rounded-lg">
                    {linked ? <BillingBadge /> : (
                        <p className="text-sm text-content-muted">
                            📝 上传后将使用 Mineru API 解析，预计需要 1-2 分钟
                        </p>
                    )}
                </div>

                {/* Error */}
                {uploadMutation.isError && (
                    <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-lg">
                        <p className="text-sm text-error">
                            上传失败: {(uploadMutation.error as Error).message}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-content-muted hover:text-content-main transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={!selectedFile || uploadMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover disabled:text-content-muted text-white rounded-lg font-medium transition-colors"
                    >
                        {uploadMutation.isPending ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                上传中...
                            </>
                        ) : (
                            <>
                                <Upload className="w-4 h-4" />
                                开始上传
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
