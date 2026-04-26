import { useEffect, useState } from 'react';
import { ArrowLeft, Search, Download, Star, Tv, Calendar, Info, PlayCircle, Loader2, Settings, X, Wand2, Archive, FolderDown } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import JSZip from 'jszip';
import { searchAnime, getAnimeDetails, getAnimeEpisodes } from './api';
import { Anime, Episode } from './types';

export default function App() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<Anime[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [errorHeader, setErrorHeader] = useState('');

  // App Settings State
  const [titleLanguage, setTitleLanguage] = useState<'english' | 'romaji'>('english');
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', geminiKey);
    setShowSettings(false);
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
    const timer = setTimeout(() => {
      if (query.trim() !== '') {
        performSearch(query);
      } else {
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = async (q: string) => {
    setIsSearching(true);
    setErrorHeader('');
    try {
      const data = await searchAnime(q);
      setResults(data.data || []);
    } catch (err: any) {
      setErrorHeader(err.message || 'Error fetching anime list');
    } finally {
      setIsSearching(false);
    }
  };

  const openDetails = async (id: number) => {
    setSelectedId(id);
    setIsLoadingDetails(true);
    setErrorHeader('');
    try {
      const anime = await getAnimeDetails(id);
      setSelectedAnime(anime);
      
      const epList = await getAnimeEpisodes(id);
      setEpisodes(epList);
    } catch (err: any) {
      setErrorHeader(err.message || 'Error fetching details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const closeDetails = () => {
    setSelectedId(null);
    setSelectedAnime(null);
    setEpisodes([]);
  };

  const [isExporting, setIsExporting] = useState(false);
  const [useAIEnhancement, setUseAIEnhancement] = useState(false);

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
        const promptText = `You are an expert otaku AI focusing on anime. 
Here is basic info for the anime '${selectedAnime.title}':
${selectedAnime.synopsis || "No description available."}
Current Genres/Tags: ${finalGenres.join(", ")}

Please expand the description into a highly detailed and engaging anime synopsis (around 2-3 paragraphs) based on your deep otaku knowledge.
Also, provide a list of 15 to 25 relevant anime genres, themes, tropes, and tags for this anime (e.g., Action, Shounen, Dark Fantasy, Mecha, Tsundere, Magic, etc.).

Return ONLY a JSON object with these two fields:
{
  "description": "The detailed synopsis string...",
  "genres": ["Action", "Sci-Fi", "Mecha", "etc..."]
}`;

        const response = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: promptText,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                genres: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["description", "genres"]
            }
          }
        });

        const textRes = response.text;
        if (textRes) {
          const aiData = JSON.parse(textRes);
          if (aiData.description) {
            finalDescription = aiData.description.trim() + "\n" + metaFooter;
          }
          if (aiData.genres && Array.isArray(aiData.genres)) {
            finalGenres = [...new Set([...finalGenres, ...aiData.genres])];
          }
        }
      } catch (aiError: any) {
        console.error("AI enhancement failed:", aiError);
        alert(`AI enhancement failed: ${aiError.message || "Unknown error."}\nFalling back to original data.`);
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
     } catch (err: any) {
        alert('Export failed: ' + err.message);
     } finally {
        setIsExporting(false);
     }
  };

  const handleExportDirect = async () => {
    if (!selectedAnime) return;
    if (!('showDirectoryPicker' in window)) {
       alert('Direct folder access is not supported on this browser (this is common on Android and mobile wrappers). Please use the "Export as ZIP" option instead to download and extract into your Aniyomi folder.');
       return;
    }
    
    setIsExporting(true);
    try {
       const dirHandle = await (window as any).showDirectoryPicker({
           mode: 'readwrite'
       });

       const folderName = selectedAnime.title.replace(/[\/\\?%*:|"<>]/g, '-');
       const animeFolderHandle = await dirHandle.getDirectoryHandle(folderName, { create: true });

       const detailsJson = await getDetailsData();
       const episodesJson = await getEpisodesData();

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

       alert(`Successfully created folder "${folderName}" and saved details.json & episodes.json!`);

    } catch (err: any) {
       if (err.name !== 'AbortError') {
           alert('Export failed: ' + err.message);
       }
    } finally {
       setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/50 border-b border-slate-800 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {selectedId ? (
              <button 
                onClick={closeDetails} 
                className="p-2 -ml-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shrink-0">
                A
              </div>
            )}
            <span className="text-lg font-semibold tracking-tight hidden sm:block">Aniyomi <span className="text-slate-500 font-normal">LocalSource Manager</span></span>
            <span className="text-lg font-semibold tracking-tight sm:hidden">Aniyomi</span>
          </div>
          
          <div className="flex items-center gap-4 flex-1 justify-end">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-md border border-slate-700 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="hidden sm:flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-md shadow-inner overflow-hidden">
              <button
                onClick={() => setTitleLanguage('english')}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm font-bold transition-all ${titleLanguage === 'english' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                EN
              </button>
              <button
                onClick={() => setTitleLanguage('romaji')}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm font-bold transition-all ${titleLanguage === 'romaji' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Orig
              </button>
            </div>

            {!selectedId && (
              <div className="relative w-full max-w-md">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search anime for local export..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-200 placeholder:text-slate-500 transition-all"
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6 sm:p-8 w-full flex-1 flex flex-col">
        {errorHeader && (
          <div className="bg-red-900/20 text-red-400 p-4 rounded-lg mb-6 border border-red-900/50 flex items-start gap-3">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{errorHeader}</p>
          </div>
        )}

        {!selectedId ? (
           // Search Grid View
          <div className="space-y-6 flex-1">
            {!query && !results.length && !isSearching && (
              <div className="flex flex-col items-center justify-center py-32 text-slate-500 space-y-4">
                <Search className="w-12 h-12 opacity-30 text-slate-400" />
                <p className="text-sm font-medium tracking-wide">Search for anime to build your library.</p>
              </div>
            )}
            
            {isSearching && results.length === 0 && (
               <div className="flex flex-col items-center justify-center py-32 text-slate-500 space-y-4">
                 <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                 <p className="text-sm">Searching the database...</p>
               </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {results.map((anime, index) => (
                <div 
                  key={`${anime.mal_id}-${index}`}
                  onClick={() => openDetails(anime.mal_id)}
                  className="group cursor-pointer flex flex-col gap-3 relative transition-all duration-300"
                >
                  <div className="aspect-[2/3] relative rounded-lg overflow-hidden bg-slate-800 shadow-xl border border-slate-700/50">
                    <img 
                      src={anime.images.webp.large_image_url} 
                      alt={anime.title} 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    
                    {anime.score && (
                      <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-md px-2 py-1 flex items-center gap-1 rounded text-xs font-bold text-white border border-slate-700">
                        <Star className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                        {anime.score}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium text-sm leading-tight text-slate-300 group-hover:text-indigo-400 transition-colors line-clamp-2" title={getDisplayTitle(anime)}>
                      {getDisplayTitle(anime)}
                    </h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 truncate">
                      {anime.type} • {anime.episodes ? `${anime.episodes} Ep` : 'Ongoing'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
           // Details View
          <>
            {isLoadingDetails || !selectedAnime ? (
              <div className="flex flex-col items-center justify-center py-32 space-y-4">
                 <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
                 <p className="text-slate-400 text-sm">Loading metadata...</p>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex-1">
                <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
                  {/* Left Column: Cover & Primary Actions */}
                  <div className="md:w-64 flex-shrink-0 flex flex-col gap-6">
                    <div className="aspect-[2/3] w-full bg-slate-800 rounded-lg shadow-2xl flex-shrink-0 border border-slate-700 p-1 relative overflow-hidden">
                       <img 
                          src={selectedAnime.images.webp.large_image_url} 
                          alt={selectedAnime.title}
                          className="w-full h-full object-cover rounded-md"
                        />
                    </div>
                    
                    <div className="bg-indigo-900/20 border border-indigo-500/30 p-5 rounded-xl flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-indigo-100">Local Export Toolkit</h3>
                        <span className="text-[10px] px-2 py-0.5 bg-indigo-500 text-white rounded-full font-bold">2.0</span>
                      </div>
                      
                      {/* AI Enhancement Toggle */}
                      <div className="flex items-center justify-between bg-slate-950/50 p-2.5 rounded-lg border border-slate-800">
                        <div className={`flex items-center gap-2 text-sm transition-colors ${useAIEnhancement ? 'text-indigo-300' : 'text-slate-400'}`}>
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

                      <div className="flex flex-col gap-2">
                        <button 
                          onClick={handleExportZip}
                          disabled={isExporting}
                          className="w-full flex items-center justify-between gap-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 p-3 rounded-lg transition-all disabled:opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            {isExporting ? (
                              <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${useAIEnhancement ? 'text-indigo-400' : 'text-slate-400'}`} />
                            ) : (
                              <Archive className={`w-4 h-4 shrink-0 ${useAIEnhancement ? 'text-indigo-400' : 'text-slate-400'}`} />
                            )}
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-semibold text-slate-200">Export as ZIP package</span>
                              <span className="text-[10px] text-slate-500">Recommended for Android & APKs</span>
                            </div>
                          </div>
                          {useAIEnhancement && <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-bold tracking-wider">AI</span>}
                        </button>
                        
                        <button 
                          onClick={handleExportDirect}
                          disabled={isExporting}
                          className="w-full flex items-center justify-between gap-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 p-3 rounded-lg transition-all disabled:opacity-50 mt-2"
                        >
                           <div className="flex items-center gap-3">
                            {isExporting ? <Loader2 className="w-4 h-4 text-slate-500 shrink-0 animate-spin" /> : <FolderDown className="w-4 h-4 text-slate-500 shrink-0" />}
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-semibold text-slate-400">Save to Local Folder directly</span>
                              <span className="text-[10px] text-slate-600">Requires Desktop Browser support</span>
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Info & Episodes */}
                  <div className="flex-1 flex flex-col">
                    <div>
                      <h1 className="text-4xl font-bold text-white mb-2 leading-tight">
                        {getDisplayTitle(selectedAnime)}
                      </h1>
                      {(selectedAnime.title_english || selectedAnime.title_japanese) && (
                        <h3 className="text-lg text-slate-500 font-medium mb-4 flex flex-wrap items-center gap-2">
                          {titleLanguage === 'english' ? selectedAnime.title : selectedAnime.title_english} 
                          {selectedAnime.title_japanese && (
                            <>
                              <span className="text-slate-700 mx-1">•</span> 
                              <span className="text-slate-400 font-serif">{selectedAnime.title_japanese}</span>
                            </>
                          )}
                        </h3>
                      )}
                      
                      <div className="flex flex-wrap gap-2 mb-6 mt-4">
                        {[...(selectedAnime.genres || []), ...(selectedAnime.explicit_genres || []), ...(selectedAnime.themes || []), ...(selectedAnime.demographics || [])].slice(0, 15).map((g, i) => (
                          <span key={`${g.mal_id}-${i}`} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-semibold text-slate-300 uppercase tracking-wider">
                            {g.name}
                          </span>
                        ))}
                      </div>

                      <p className="text-slate-400 text-sm leading-relaxed max-w-3xl mb-8">
                        {selectedAnime.synopsis || "No synopsis available."}
                      </p>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-md">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Status</p>
                          <p className="text-sm text-slate-200">{selectedAnime.status}</p>
                        </div>
                        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-md">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Format</p>
                          <p className="text-sm text-slate-200">{selectedAnime.type}</p>
                        </div>
                        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-md">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Episodes</p>
                          <p className="text-sm text-slate-200">{selectedAnime.episodes || 'TBA'}</p>
                        </div>
                        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-md">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Score</p>
                          <p className="text-sm text-slate-200 flex items-center gap-1">
                            <Star className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                            {selectedAnime.score || 'N/A'}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-8 border-t border-slate-800 flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-4 shrink-0">
                        <h3 className="text-lg font-bold text-slate-200">Episode Index <span className="text-slate-500 text-sm font-normal ml-2">({episodes.length})</span></h3>
                      </div>
                      
                      {episodes.length === 0 ? (
                        <p className="text-slate-500 italic bg-slate-900/50 border border-slate-800 p-4 rounded-lg text-sm">No episode data available for this anime.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-8">
                          {episodes.map((ep, index) => (
                            <div key={`${ep.mal_id}-${index}`} className="bg-slate-900/50 border border-slate-800 hover:bg-slate-800/80 hover:border-slate-700 p-3 rounded-lg flex items-center gap-3 transition-colors h-16">
                               <div className="text-sm font-bold text-indigo-400 bg-slate-950 border border-slate-800 shadow-inner py-1 w-12 text-center rounded shrink-0 font-mono">
                                 <span className="text-[10px] text-slate-600 mr-0.5">EP</span>{ep.mal_id}
                               </div>
                               <div className="flex flex-col overflow-hidden justify-center h-full">
                                 <span className="font-medium text-sm text-slate-300 truncate leading-tight" title={ep.title}>{ep.title}</span>
                                 <span className="text-[11px] text-slate-500 mt-0.5 tracking-wide uppercase truncate">
                                   {ep.aired ? new Date(ep.aired).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'TBA'} {ep.filler && '• FLR'} {ep.recap && '• RCP'}
                                 </span>
                               </div>
                            </div>
                          ))}
                        </div>
                      )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Gemini API Key
                </label>
                <div className="flex flex-col gap-2">
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-200 placeholder:text-slate-600 transition-all font-mono"
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Required for the <strong className="text-indigo-400 font-semibold">AI Enhanced</strong> feature if deployed as a static APK or standalone app. You can get a free key from Google AI Studio. 
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS fixes for custom scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
}
