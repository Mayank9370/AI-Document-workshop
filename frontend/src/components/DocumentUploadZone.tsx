'use client';

import React, { useState, useRef } from 'react';
import { uploadPdfDocument } from '../services/api.service';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface DocumentUploadZoneProps {
  onUploadSuccess: () => void;
}

export const DocumentUploadZone: React.FC<DocumentUploadZoneProps> = ({ onUploadSuccess }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    // Client-side validation: PDF extension & MIME type
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Invalid file type. Only PDF documents (.pdf) are allowed.');
      return;
    }

    // Client-side validation: Max 10 MB
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage(
        `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed limit of 10 MB.`
      );
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      await uploadPdfDocument(file, (percent) => {
        setUploadProgress(percent);
      });

      setSuccessMessage(`Document "${file.name}" uploaded successfully!`);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onUploadSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drag & Drop Card */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition cursor-pointer ${
          isDragging
            ? 'border-indigo-500 bg-indigo-500/10'
            : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/70'
        } ${isUploading ? 'opacity-70 pointer-events-none' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="max-w-md mx-auto space-y-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold text-white">
              {isUploading ? 'Uploading PDF Document...' : 'Drag and drop your PDF here'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              or <span className="text-indigo-400 font-medium hover:underline">browse files</span> from your computer
            </p>
          </div>

          <div className="inline-flex items-center gap-2 text-[11px] text-slate-500 bg-slate-950/60 px-3 py-1 rounded-full border border-slate-800">
            <FileText className="w-3.5 h-3.5" />
            <span>PDF files only &bull; Max 10 MB</span>
          </div>

          {/* Progress Bar */}
          {uploadProgress !== null && (
            <div className="mt-4 space-y-1.5 text-left">
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
