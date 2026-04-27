import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ArrowLeft, Search, Download, Star, Tv, Calendar, Info, PlayCircle, Loader2, Settings, X, Wand2, Archive, FolderDown, FolderCheck, Clock } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import JSZip from 'jszip';
import { searchAnime, getAnimeDetails, getAnimeEpisodes } from './api';
import { Anime, Episode } from './types';
import { saveDirHandle, getDirHandle, verifyPermission } from './db';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Dialog } from '@capacitor/dialog';

export default function App() {
    const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Anime[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [errorHeader, setErrorHeader] = useState('');

  // App Settings State
  const [titleLanguage, setTitleLanguage] = useState<'english' | 'romaji'>('english');
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [dirHandle, setDirHandle] = useState<any>(null);
  const hasFSAPI = 'showDirectoryPicker' in window;
  
  // Recent Anime History
  const [recentAnime, setRecentAnime] = useState<Anime[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hasFSAPI) {
      getDirHandle().then(handle => {
        if (handle) setDirHandle(handle);
      }).catch(console.error);
    }
    const savedRecent = localStorage.getItem('recent_anime');
    if (savedRecent) {
      try {
        setRecentAnime(JSON.parse(savedRecent));
      } catch (e) {}
    }
  }, []);

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', geminiKey);
    setShowSettings(false);
  };
  
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const saveRecentAnime = (anime: Anime) => {
    setRecentAnime(prev => {
      const filtered = prev.filter(a => a.mal_id !== anime.mal_id);
      const updated = [anime, ...filtered].slice(0, 10);
      localStorage.setItem('recent_anime', JSON.stringify(updated));
      return updated;
    });
  };

  const pickDirectory = async () => {
    if (!hasFSAPI) return;
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await saveDirHandle(handle);
      setDirHandle(handle);
      showToast('Directory selected and saved successfully!');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to pick directory:', err);
        const msg = err.message || '';
        if (msg.toLowerCase().includes('cross origin') || msg.toLowerCase().includes('sub frame')) {
          alert('Folder selection is not allowed in this preview. Please open the app in a new tab to use this feature.');
        } else {
          alert(`Failed to pick directory: ${msg}`);
        }
      }
    }
  };

  const getDisplayTitle = (anime: Anime) => {
    if (titleLanguage === 'english' && anime.title_english) {
      return anime.title_english;
    }
    return anime.title;
  };

  // Details View State
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Debounced Search
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim() === '') {
        setResults([]);
        return;
      }

      const fetchSearchResults = async () => {
        setIsLoading(true);
        setErrorHeader('');
        try {
          const data = await searchAnime(query);
          setResults(data);
        } catch (err) {
          console.error(err);
          setErrorHeader('Failed to search anime. Rate limit or network issue.');
        } finally {
          setIsLoading(false);
        }
      };

      fetchSearchResults();
    }, 600); // 600ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const openDetails = async (id: number) => {
    setSelectedId(id);
    setIsLoadingDetails(true);
    setSelectedAnime(null);
    setEpisodes([]);
    setErrorHeader('');

    try {
      const anime = await getAnimeDetails(id);
      setSelectedAnime(anime);
      
      const epList = await getAnimeEpisodes(id);
      setEpisodes(epList);
      
      saveRecentAnime(anime);
    } catch (err: any) {
      console.error(err);
      setErrorHeader('Failed to fetch details. Rate limit or network issue.');
      const msg = err.message || 'Failed to fetch anime details. Please check your network connection or try again later.';
      if (Capacitor.isNativePlatform()) {
        Dialog.alert({ title: 'Error', message: msg });
      } else {
        alert(msg);
      }
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const goBack = () => {
    setSelectedId(null);
    setSelectedAnime(null);
    setEpisodes([]);
  };

  const [isExporting, setIsExporting] = useState(false);
  const [exportStatusText, setExportStatusText] = useState('Exporting...');
  const [useAIEnhancement, setUseAIEnhancement] = useState(false);
  const [aiModel, setAiModel] = useState(() => localStorage.getItem('ai_model') || 'gemini-3.1-pro-preview');
  const [useGrounding, setUseGrounding] = useState(() => localStorage.getItem('ai_grounding') === 'true');

  useEffect(() => {
    localStorage.setItem('ai_model', aiModel);
  }, [aiModel]);

  useEffect(() => {
    localStorage.setItem('ai_grounding', useGrounding.toString());
  }, [useGrounding]);

  const getDetailsData = async (): Promise<string | null> => {
    if (!selectedAnime) return null;
    
    let finalGenres = Array.from(new Set([
      ...(selectedAnime.genres?.map(g => g.name) || []),
      ...(selectedAnime.explicit_genres?.map(g => g.name) || []),
      ...(selectedAnime.themes?.map(g => g.name) || []),
      ...(selectedAnime.demographics?.map(g => g.name) || [])
    ]));

    let statusNum = 0; // Unknown
    if (selectedAnime.status?.includes('Finished') || selectedAnime.status?.includes('Complete')) {
      statusNum = 2; // Completed
    } else if (selectedAnime.status?.includes('Currently Airing') || selectedAnime.status?.includes('Ongoing')) {
      statusNum = 1; // Ongoing
    }

    const altTitlesList = [
      selectedAnime.title_english, 
      selectedAnime.title_japanese, 
      ...(selectedAnime.title_synonyms || [])
    ].filter(Boolean);
    const altTitles = [...new Set(altTitlesList)].join(', ');

    const seasonStr = selectedAnime.season 
      ? `${selectedAnime.season.charAt(0).toUpperCase() + selectedAnime.season.slice(1)} ${selectedAnime.year || ''}`.trim()
      : selectedAnime.year?.toString() || 'N/A';

    let combinedDescription = selectedAnime.synopsis || '';
    
    let metaFooter = '';
    if (selectedAnime.background) {
      metaFooter += `\n\nBackground: ${selectedAnime.background}`;
    } else {
      metaFooter += `\n\n`;
    }

    metaFooter += `Country: Japan`;
    metaFooter += `\nPremiered: ${seasonStr}`;
    metaFooter += `\nDate aired: ${selectedAnime.aired?.string || 'N/A'}`;
    metaFooter += `\nDuration: ${selectedAnime.duration || 'N/A'}`;
    metaFooter += `\nRating: ${selectedAnime.rating || 'N/A'}`;
    metaFooter += `\nMAL rating: ${selectedAnime.score || 'N/A'}`;
    if (altTitles) {
      metaFooter += `\nAlternative Titles: ${altTitles}`;
    }

    combinedDescription += metaFooter;
    let finalDescription = combinedDescription.trim();

    // Call AI to enhance description and genres
    if (useAIEnhancement) {
      try {
        const apiKeyToUse = geminiKey || process.env.GEMINI_API_KEY;
        if (!apiKeyToUse) {
          throw new Error("Missing Gemini API Key. Please click the Settings gear icon to add your own key, or disable AI enhancement.");
        }

        const ai = new GoogleGenAI({ apiKey: apiKeyToUse });
        
        // --- STEP 1: Enhance Description ---
        setExportStatusText('Enhancing description...');
        const descPromptText = `You are an expert anime AI. Here is info for '${selectedAnime.title}':
Original synopsis: ${selectedAnime.synopsis || "No description available."}
Please write a highly engaging and detailed expanded synopsis (2-3 paragraphs) based on your knowledge of this anime.
Return ONLY a JSON object with this shape: { "description": "The detailed synopsis string..." }`;

        const descReqConfig: any = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { description: { type: Type.STRING } },
            required: ["description"]
          }
        };
        if (useGrounding) descReqConfig.tools = [{ googleSearch: {} }];

        const descResponse = await ai.models.generateContent({
          model: aiModel,
          contents: descPromptText,
          config: descReqConfig
        });
        
        const descTextRes = descResponse.text;
        if (descTextRes) {
          try {
            const aiData = JSON.parse(descTextRes);
            if (aiData.description) {
              finalDescription = aiData.description.trim() + "\n" + metaFooter;
            }
          } catch(e) {}
        }

        // --- STEP 2: Enhance Genres ---
        setExportStatusText('Enhancing genres...');
        const genresPromptText = `You are an expert anime AI. Here is info for '${selectedAnime.title}':
Current Genres: ${finalGenres.join(", ")}
Please provide a list of 15-25 accurate anime genres, sub-genres, themes, and tropes for this anime.
Return ONLY a JSON object with this shape: { "genres": ["string", "string"] }`;

        const genresReqConfig: any = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genres: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["genres"]
          }
        };
        if (useGrounding) genresReqConfig.tools = [{ googleSearch: {} }];

        const genresResponse = await ai.models.generateContent({
          model: aiModel,
          contents: genresPromptText,
          config: genresReqConfig
        });
        
        const genresTextRes = genresResponse.text;
        if (genresTextRes) {
          try {
            const aiData = JSON.parse(genresTextRes);
            if (aiData.genres && Array.isArray(aiData.genres)) {
              finalGenres = [...new Set([...finalGenres, ...aiData.genres])];
            }
          } catch(e) {}
        }
        
        setExportStatusText('Packaging data...');

      } catch (aiError: any) {
        console.error("AI enhancement failed:", aiError);
        const errMsg = `AI enhancement failed: ${aiError.message || "Unknown error."}\nFalling back to original data.`;
        if (Capacitor.isNativePlatform()) {
          await Dialog.alert({ title: 'AI Error', message: errMsg });
        } else {
          alert(errMsg);
        }
      } finally {
        setExportStatusText('Exporting...');
      }
    }

    // Map it to an Aniyomi-esque format as requested
    const detailsFormat = {
      title: selectedAnime.title,
      author: selectedAnime.studios?.map(s => s.name).join(', ') || 'Unknown',
      artist: selectedAnime.studios?.map(s => s.name).join(', ') || 'Unknown',
      description: finalDescription,
      genre: finalGenres,
      status: statusNum
    };

    return JSON.stringify(detailsFormat, null, 2);
  };

  const getEpisodesData = async (): Promise<string | null> => {
    if (!selectedAnime || episodes.length === 0) return null;

    const isDubbed = !!selectedAnime.title_english;
    
    // Create episode data
    const episodesFormat = episodes.map(ep => {
      let dateUpload = "1970-01-01T00:00:00";
      if (ep.aired) {
        try {
          const dateObj = new Date(ep.aired);
          // Format to YYYY-MM-DDTHH:MM:SS locally
          dateUpload = dateObj.getFullYear() + "-" + 
                       String(dateObj.getMonth() + 1).padStart(2, '0') + "-" + 
                       String(dateObj.getDate()).padStart(2, '0') + "T" + 
                       String(dateObj.getHours()).padStart(2, '0') + ":" + 
                       String(dateObj.getMinutes()).padStart(2, '0') + ":" + 
                       String(dateObj.getSeconds()).padStart(2, '0');
        } catch(e) {}
      }

      return {
        episode_number: ep.mal_id,
        name: `Episode ${ep.mal_id}: ${ep.title}`,
        date_upload: dateUpload,
        scanlator: isDubbed ? "Sub, Dub" : "Sub"
      };
    });

    return JSON.stringify(episodesFormat, null, 2);
  };

  const handleExportZip = async () => {
     if (!selectedAnime) return;
     setIsExporting(true);
     try {
        const detailsJson = await getDetailsData();
        const episodesJson = await getEpisodesData();

        const zip = new JSZip();
        const folderName = selectedAnime.title.replace(/[\/\\?%*:|"<>]/g, '-');
        const folder = zip.folder(folderName);
        if (folder) {
           if (detailsJson) folder.file('details.json', detailsJson);
           if (episodesJson) folder.file('episodes.json', episodesJson);
        }
        
        const blob = await zip.generateAsync({ type: 'blob' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`Successfully downloaded ${folderName}.zip!`);
     } catch (err: any) {
        const msg = 'Export failed: ' + err.message;
        if (Capacitor.isNativePlatform()) {
           await Dialog.alert({ title: 'Export Failed', message: msg });
        } else {
           alert(msg);
        }
     } finally {
        setIsExporting(false);
     }
  };

  const handleExportDirect = async () => {
    if (!selectedAnime) return;
    
    setIsExporting(true);

    try {
      const folderName = selectedAnime.title.replace(/[\/\\?%*:|"<>]/g, '-');
      const detailsJson = await getDetailsData();
      const episodesJson = await getEpisodesData();
  
      // === NATIVE ANDROID/APK EXPORT ===
      if (Capacitor.isNativePlatform()) {
        const basePath = `Aniyomi/local/${folderName}`;
        
        if (detailsJson) {
           await Filesystem.writeFile({
             path: `${basePath}/details.json`,
             data: detailsJson,
             directory: Directory.ExternalStorage,
             encoding: Encoding.UTF8,
             recursive: true
           });
        }
        
        if (episodesJson) {
           await Filesystem.writeFile({
             path: `${basePath}/episodes.json`,
             data: episodesJson,
             directory: Directory.ExternalStorage,
             encoding: Encoding.UTF8,
             recursive: true
           });
        }
        
        showToast(`Saved natively to Android storage: /sdcard/${basePath}`);
        setIsExporting(false);
        return;
      }
  
      // === WEB BROWSER EXPORT ===
      if (!hasFSAPI) {
         alert('Direct folder access is not supported on this browser (this is common on Android and mobile wrappers). Please use the "Export as ZIP" option instead to download and extract into your Aniyomi folder.');
         setIsExporting(false);
         return;
      }
      
      let targetDirHandle = dirHandle;
      
      if (!targetDirHandle) {
          try {
              targetDirHandle = await (window as any).showDirectoryPicker({
                  mode: 'readwrite'
              });
          } catch (pickerErr: any) {
              const msg = pickerErr.message || '';
              if (msg.toLowerCase().includes('cross origin') || msg.toLowerCase().includes('sub frame')) {
                  throw new Error("Folder selection is not allowed in this preview. Please open the app in a new tab, or use 'Export as ZIP'.");
              }
              throw pickerErr;
          }
          await saveDirHandle(targetDirHandle);
          setDirHandle(targetDirHandle);
      } else {
          const hasPermission = await verifyPermission(targetDirHandle, true);
          if (!hasPermission) {
              throw new Error("Permission to access the saved folder was denied.");
          }
      }
  
      const animeFolderHandle = await targetDirHandle.getDirectoryHandle(folderName, { create: true });
  
      if (detailsJson) {
          const detailsFileHandle = await animeFolderHandle.getFileHandle('details.json', { create: true });
          const detailsWritable = await detailsFileHandle.createWritable();
          await detailsWritable.write(detailsJson);
          await detailsWritable.close();
      }
  
      if (episodesJson) {
          const episodesFileHandle = await animeFolderHandle.getFileHandle('episodes.json', { create: true });
          const episodesWritable = await episodesFileHandle.createWritable();
          await episodesWritable.write(episodesJson);
          await episodesWritable.close();
      }
  
      showToast(`Successfully created folder "${folderName}" and saved details & episodes!`);
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            const msg = 'Export failed: ' + err.message;
            if (Capacitor.isNativePlatform()) {
              await Dialog.alert({ title: 'Export Failed', message: err.message || 'Please ensure the app has Storage permissions.' });
            } else {
              alert(msg);
            }
        }
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 selection:bg-indigo-500/30 selection:text-indigo-200 font-sans">
      <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center h-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {selectedId && (
              <button 
                onClick={goBack}
                className="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="text-slate-900 dark:text-white font-bold text-lg leading-none select-none">A</span>
            </div>
            <span className="text-lg font-semibold tracking-tight hidden sm:block">Aniyomi <span className="text-slate-500 dark:text-slate-500 font-normal">LocalSource Manager</span></span>
            <span className="text-lg font-semibold tracking-tight sm:hidden">Aniyomi</span>
          </div>
          
          <div className="flex items-center gap-4 flex-1 justify-end">
                        <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-1.5 text-slate-800 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 transition-colors"
              aria-label="Toggle theme"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-300 dark:border-slate-700 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="hidden sm:flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-md shadow-inner overflow-hidden">
              <button
                onClick={() => setTitleLanguage('english')}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm font-bold transition-all ${titleLanguage === 'english' ? 'bg-indigo-500 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                EN
              </button>
              <button
                onClick={() => setTitleLanguage('romaji')}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm font-bold transition-all ${titleLanguage === 'romaji' ? 'bg-indigo-500 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                Orig
              </button>
            </div>

            {!selectedId && (
              <div className="relative w-full max-w-md group group-focus-within:max-w-lg transition-all duration-300 ease-out">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 transition-colors group-focus-within:text-indigo-500" />
                <input
                  type="text"
                  placeholder="Search Jikan API..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-800 dark:text-slate-200 placeholder:text-slate-500 transition-all duration-300 group-focus-within:shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {errorHeader && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm py-2 px-4 text-center">
          {errorHeader}
        </div>
      )}

      <main className="min-h-[calc(100vh-4rem)]">
        {!selectedId ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center text-center py-12 mb-8">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
                Manage your <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Local Source</span>
              </h1>
              <p className="max-w-2xl text-slate-600 dark:text-slate-400 text-lg">
                Search the MyAnimeList database, generate perfectly formatted metadata, and export it directly to Aniyomi.
              </p>
            </div>

            {/* Search Results */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="flex flex-col gap-3 animate-pulse">
                    <div className="aspect-[2/3] w-full bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-3/4"></div>
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-md w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {results.map((anime, index) => (
                  <div 
                    key={`${anime.mal_id}-${index}`}
                    onClick={() => openDetails(anime.mal_id)}
                    className="group cursor-pointer flex flex-col gap-3 relative transition-all duration-300"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 shadow-sm group-hover:shadow-indigo-500/20 group-hover:border-indigo-500/50 transition-all duration-300">
                      {anime.images?.webp?.large_image_url ? (
                        <img 
                          src={anime.images.webp.large_image_url} 
                          alt={getDisplayTitle(anime)} 
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">No Image</div>
                      )}
                      
                      <div className="absolute top-2 right-2 bg-white dark:bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded-md flex items-center gap-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-700 shadow-sm">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <span>{anime.score || 'N/A'}</span>
                      </div>
                      
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                        <span className="w-full text-center bg-indigo-500 text-slate-900 dark:text-white text-xs font-bold py-1.5 rounded opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                          View Details
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-medium text-sm leading-tight text-slate-700 dark:text-slate-300 group-hover:text-indigo-400 transition-colors line-clamp-2" title={getDisplayTitle(anime)}>
                        {getDisplayTitle(anime)}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-500 mt-1 flex items-center gap-2 truncate">
                        {anime.type} • {anime.episodes ? `${anime.episodes} Ep` : 'Ongoing'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : query.trim() !== '' ? (
              <div className="text-center py-20 text-slate-500 dark:text-slate-500">
                No results found for "{query}".
              </div>
            ) : recentAnime.length > 0 ? (
              <div className="space-y-6">
                 <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <Clock className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Recently Viewed</h2>
                 </div>
                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                   {recentAnime.map((anime, index) => (
                    <div 
                      key={`${anime.mal_id}-recent-${index}`}
                      onClick={() => openDetails(anime.mal_id)}
                      className="group cursor-pointer flex flex-col gap-3 relative transition-all duration-300"
                    >
                      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 shadow-sm group-hover:shadow-indigo-500/20 group-hover:border-indigo-500/50 transition-all duration-300">
                        {anime.images?.webp?.large_image_url ? (
                          <img 
                            src={anime.images.webp.large_image_url} 
                            alt={getDisplayTitle(anime)} 
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">No Image</div>
                        )}
                        
                        <div className="absolute top-2 right-2 bg-white dark:bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded-md flex items-center gap-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-700 shadow-sm">
                          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          <span>{anime.score || 'N/A'}</span>
                        </div>
                      </div>
                      <div>
                        <h3 className="font-medium text-sm leading-tight text-slate-700 dark:text-slate-300 group-hover:text-indigo-400 transition-colors line-clamp-2" title={getDisplayTitle(anime)}>
                          {getDisplayTitle(anime)}
                        </h3>
                      </div>
                    </div>
                  ))}
                 </div>
              </div>
            ) : null}
          </div>
        ) : (
           // Details View
          <>
            {isLoadingDetails || !selectedAnime ? (
              <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Loading Anime...</h3>
                <p className="text-slate-600 dark:text-slate-400 animate-pulse">Fetching complete details from Jikan API...</p>
              </div>
            ) : (
              <div className="animate-in fade-in duration-500">
                {/* Hero Banner Background */}
                <div className="w-full h-64 sm:h-80 relative overflow-hidden -mt-16">
                  <div className="absolute inset-0 bg-slate-50 dark:bg-slate-900">
                    <img 
                      src={selectedAnime.images?.webp?.large_image_url} 
                      alt=""
                      className="w-full h-full object-cover opacity-20 blur-xl scale-110"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-50 dark:from-slate-950 via-slate-50/80 dark:via-slate-950/80 to-transparent" />
                </div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative -mt-32 sm:-mt-48 pb-12">
                  <div className="flex flex-col sm:flex-row gap-6 sm:gap-10">
                    
                    {/* Left Column (Poster) */}
                    <div className="w-48 sm:w-64 shrink-0 mx-auto sm:mx-0 relative z-10">
                      <div className="w-full aspect-[2/3] rounded-xl overflow-hidden shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800">
                        <img 
                          src={selectedAnime.images?.webp?.large_image_url} 
                          alt={getDisplayTitle(selectedAnime)} 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      
                      {/* Export Toolkit */}
                      <div className="mt-6 space-y-4">
                        <div className="bg-indigo-100 dark:bg-indigo-900/20 border border-indigo-300 dark:border-indigo-500/30 p-5 rounded-xl flex flex-col gap-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">Local Export Toolkit</h3>
                            <span className="text-[10px] px-2 py-0.5 bg-indigo-500 text-white rounded-full font-bold">3.0</span>
                          </div>
                          
                          {/* AI Enhancement Toggle */}
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                              <div className={`flex items-center gap-2 text-sm transition-colors ${useAIEnhancement ? 'text-indigo-300' : 'text-slate-600 dark:text-slate-400'}`}>
                                <Wand2 className="w-4 h-4" />
                                <span className="font-medium">AI Enhanced</span>
                              </div>
                              <button 
                                type="button"
                                role="switch"
                                aria-checked={useAIEnhancement}
                                onClick={() => setUseAIEnhancement(!useAIEnhancement)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${useAIEnhancement ? 'bg-indigo-500' : 'bg-slate-700'}`}
                              >
                                <span aria-hidden="true" className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${useAIEnhancement ? 'translate-x-2' : '-translate-x-2'}`} />
                              </button>
                            </div>

                            {useAIEnhancement && (
                              <div className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2">
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">AI Model</label>
                                  <select 
                                    value={aiModel} 
                                    onChange={e => setAiModel(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded py-1.5 px-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  >
                                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Recommended)</option>
                                    <option value="gemini-3.1-flash-preview">Gemini 3.1 Flash</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                  </select>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                  <label className="text-[10px] font-medium text-slate-600 dark:text-slate-400">Google Search Grounding</label>
                                  <button 
                                    type="button"
                                    role="switch"
                                    aria-checked={useGrounding}
                                    onClick={() => setUseGrounding(!useGrounding)}
                                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${useGrounding ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                  >
                                    <span aria-hidden="true" className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${useGrounding ? 'translate-x-1.5' : '-translate-x-1.5'}`} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-2">
                            <button 
                              onClick={handleExportZip}
                              disabled={isExporting}
                              className="w-full flex items-center justify-between gap-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 p-3 rounded-lg transition-all disabled:opacity-50"
                            >
                              <div className="flex items-center gap-3">
                                {isExporting ? (
                                  <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${useAIEnhancement ? 'text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`} />
                                ) : (
                                  <Archive className={`w-4 h-4 shrink-0 ${useAIEnhancement ? 'text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`} />
                                )}
                                <div className="flex flex-col text-left">
                                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Export as ZIP package</span>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-500">Recommended for Android & APKs</span>
                                </div>
                              </div>
                              {useAIEnhancement && <span className="text-[10px] bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5 rounded font-bold tracking-wider">AI</span>}
                            </button>

                            <button 
                              onClick={handleExportDirect}
                              disabled={isExporting}
                              className="w-full flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-lg transition-all disabled:opacity-50 mt-2"
                            >
                               <div className="flex items-center gap-3">
                                {isExporting ? <Loader2 className="w-4 h-4 text-slate-500 dark:text-slate-500 shrink-0 animate-spin" /> : <FolderDown className="w-4 h-4 text-slate-500 dark:text-slate-500 shrink-0" />}
                                <div className="flex flex-col text-left">
                                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Save to Local Folder</span>
                                  <span className="text-[10px] text-slate-600">Requires Native/Desktop access</span>
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800/80">
                           <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                             <Info className="w-3 h-3" />
                             Format Preview
                           </h4>
                           <div className="flex flex-col gap-1 text-xs font-mono text-slate-500 dark:text-slate-500">
                             <span className="text-indigo-600 dark:text-indigo-400">details.json</span>
                             <span>- Title, Sysnopsis</span>
                             <span>- Genres, Status</span>
                             <span className="text-indigo-600 dark:text-indigo-400 mt-2">episodes.json</span>
                             <span>- EP Name, Number</span>
                             <span>- Date Upload, Scanlator</span>
                           </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column (Info) */}
                    <div className="flex-1 flex flex-col">
                      <div>
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 leading-tight">
                          {getDisplayTitle(selectedAnime)}
                        </h1>
                        {(selectedAnime.title_english || selectedAnime.title_japanese) && (
                          <h3 className="text-lg text-slate-500 dark:text-slate-500 font-medium mb-4 flex flex-wrap items-center gap-2">
                            {titleLanguage === 'english' ? selectedAnime.title : selectedAnime.title_english} 
                            {selectedAnime.title_japanese && (
                              <>
                                <span className="text-slate-700 mx-1">•</span> 
                                <span className="text-slate-600 dark:text-slate-400 font-serif">{selectedAnime.title_japanese}</span>
                              </>
                            )}
                          </h3>
                        )}
                        
                        <div className="flex flex-wrap gap-2 mb-6 mt-4">
                          <span className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5" />
                            {selectedAnime.score || 'unrated'}
                          </span>
                          <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5">
                            <Tv className="w-3.5 h-3.5" />
                            {selectedAnime.type || 'Unknown'} {selectedAnime.episodes ? `(${selectedAnime.episodes} Ep)` : ''}
                          </span>
                          {selectedAnime.year && (
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5" />
                              {selectedAnime.season ? `${selectedAnime.season} ` : ''}{selectedAnime.year}
                            </span>
                          )}
                          <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 px-3 py-1 rounded-full text-xs font-medium">
                            {selectedAnime.status}
                          </span>
                        </div>

                        <div className="mb-8">
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Synopsis</h2>
                          <div className="prose prose-invert prose-sm max-w-none text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                            {selectedAnime.synopsis || 'No synopsis available.'}
                          </div>
                        </div>

                        {/* Episodes List View */}
                        <div className="flex-1 flex flex-col mb-8 h-96">
                          <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                              <PlayCircle className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                              Episodes Data
                            </h2>
                            <span className="text-xs text-slate-500 dark:text-slate-500 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-full">{episodes.length} files</span>
                          </div>
                        
                          {episodes.length === 0 ? (
                            <p className="text-slate-500 dark:text-slate-500 italic bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-sm">No episode data available for this anime.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-8">
                              {episodes.map((ep, index) => (
                                <div key={`${ep.mal_id}-${index}`} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 p-3 rounded-lg flex items-center gap-3 transition-colors h-16">
                                   <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-inner py-1 w-12 text-center rounded shrink-0 font-mono">
                                     <span className="text-[10px] text-slate-600 mr-0.5">EP</span>{ep.mal_id}
                                   </div>
                                   <div className="flex flex-col overflow-hidden justify-center h-full">
                                     <span className="font-medium text-sm text-slate-700 dark:text-slate-300 truncate leading-tight" title={ep.title}>{ep.title}</span>
                                     {ep.aired && <span className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 font-mono">{new Date(ep.aired).toLocaleDateString()}</span>}
                                   </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Gemini API Key
                </label>
                <div className="flex flex-col gap-2">
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-800 dark:text-slate-200 placeholder:text-slate-600 transition-all font-mono"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-500 leading-relaxed">
                    Required for the <strong className="text-indigo-500 dark:text-indigo-400 font-semibold">AI Enhanced</strong> feature if deployed as a static APK or standalone app. You can get a free key from Google AI Studio. 
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  AI Model
                </label>
                <select 
                  value={aiModel} 
                  onChange={e => setAiModel(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md py-2 px-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Recommended)</option>
                  <option value="gemini-3.1-flash-preview">Gemini 3.1 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Aniyomi Local Source Folder
                </label>
                <div className="flex flex-col gap-2">
                  {Capacitor.isNativePlatform() ? (
                    <div className="bg-emerald-100 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-500/30 rounded-md p-3">
                      <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed text-center font-medium">
                        Running natively on Android. Exporting will automatically save to <strong className="text-emerald-400">/sdcard/Aniyomi/local</strong> using the Android OS file system.
                      </p>
                    </div>
                  ) : hasFSAPI ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={pickDirectory}
                        className="flex-1 flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 rounded-md py-2 px-3 text-sm transition-all text-slate-800 dark:text-slate-200"
                      >
                        {dirHandle ? (
                          <>
                            <FolderCheck className="w-4 h-4 text-emerald-400" />
                            <span>Folder Selected</span>
                          </>
                        ) : (
                          <>
                            <FolderDown className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                            <span>Select Folder</span>
                          </>
                        )}
                      </button>
                      {dirHandle && (
                        <button
                          onClick={async () => {
                            await saveDirHandle(null);
                            setDirHandle(null);
                          }}
                          className="p-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400 rounded-md text-slate-600 dark:text-slate-400 transition-all"
                          title="Clear Folder"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-amber-100 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/30 rounded-md p-3">
                      <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed text-center font-medium">
                        Direct folder access is not supported on Android/WebView. You must use the "Export as ZIP" feature instead.
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-500 leading-relaxed">
                    Automatically export to this folder when using <strong>Direct Export</strong>. Usually located at <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-slate-600 dark:text-slate-400">/sdcard/Aniyomi/local</code>.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 rounded-md text-sm font-medium text-slate-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exporting Overlay */}
      {isExporting && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{exportStatusText}</h3>
          <p className="text-slate-600 dark:text-slate-400">Packaging details and episodes into your local library.</p>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[100] bg-emerald-500/90 border border-emerald-400/50 text-slate-900 dark:text-white px-6 py-3 rounded-full shadow-[0_0_40px_rgba(16,185,129,0.3)] backdrop-blur-md animate-in slide-in-from-bottom-5 fade-in duration-300 flex items-center gap-2">
           <FolderCheck className="w-5 h-5" />
           <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* Global CSS fixes for custom scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 1);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(51, 65, 85, 0.8);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 1);
        }
        
        /* Disable text selection in app-like context */
        body {
          -webkit-user-select: none;
          user-select: none;
        }
        input, textarea {
          -webkit-user-select: auto;
          user-select: auto;
        }
      `}</style>
    </div>
  );
}
