// --- Global State ---
let currentTab = 'upload';
let generatedData = { summary: null, flashcards: null, quiz: null };
let quizState = { currentQuestionIndex: 0, score: 0 };

// Default API Fleet - Keys are stored ONLY in browser localStorage (never in code)
// Add keys via the Admin Panel in the Team Profile tab
let apiFleet = JSON.parse(localStorage.getItem('studyspark_api_fleet') || '[]');
let currentApiIndex = 0;

// History State
let sessions = JSON.parse(localStorage.getItem('studyspark_history') || '[]');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('nav-upload').classList.add('active');
    
    // Load custom API fleet if modified in Admin
    const savedFleet = localStorage.getItem('studyspark_api_fleet');
    if (savedFleet) apiFleet = JSON.parse(savedFleet);

    const savedPwd = localStorage.getItem('app_password');
    if (savedPwd) document.getElementById('app-password-input').value = savedPwd;
    
    document.getElementById('app-password-input').addEventListener('change', (e) => {
        localStorage.setItem('app_password', e.target.value.trim());
    });

    renderHistoryList();
    renderApiAdminList();
});

// --- UI Navigation ---
function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active', 'text-brand-400', 'bg-brand-500/10');
        btn.classList.add('text-slate-400');
    });
    
    const activeBtn = document.getElementById(`nav-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'text-brand-400', 'bg-brand-500/10');
        activeBtn.classList.remove('text-slate-400');
    }

    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
        tab.classList.remove('block');
    });

    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) {
        targetTab.classList.remove('hidden');
        targetTab.classList.add('block');
        targetTab.style.animation = 'none';
        targetTab.offsetHeight; 
        targetTab.style.animation = null;
    }
    currentTab = tabId;
}

function togglePasswordVisibility() {
    const input = document.getElementById('app-password-input');
    const icon = document.getElementById('pwd-eye-icon');
    if (input.type === 'password') {
        input.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function clearNotes() {
    document.getElementById('notes-input').value = '';
    showToast('Notes cleared');
}

function copyToClipboard(elementId) {
    const content = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(content).then(() => showToast('Copied to clipboard!', 'success'));
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    const icon = document.getElementById('toast-icon');
    
    if (type === 'success') { icon.className = 'fa-solid fa-circle-check text-brand-400 text-xl'; document.getElementById('toast-title').innerText = 'Success'; }
    else if (type === 'error') { icon.className = 'fa-solid fa-triangle-exclamation text-red-400 text-xl'; document.getElementById('toast-title').innerText = 'Error'; }
    else { icon.className = 'fa-solid fa-circle-info text-blue-400 text-xl'; document.getElementById('toast-title').innerText = 'Info'; }

    toast.classList.add('toast-show');
    setTimeout(() => toast.classList.remove('toast-show'), 3000);
}

// --- File Upload Logic ---
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const notesInput = document.getElementById('notes-input');
    notesInput.value = 'Extracting text... please wait.';
    showToast(`Reading ${file.name}...`);

    try {
        if (file.name.endsWith('.pdf')) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(item => item.str).join(' ') + '\n';
            }
            notesInput.value = text.trim();
            showToast('PDF text extracted successfully!', 'success');
        } else if (file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
            const text = await file.text();
            notesInput.value = text.trim();
            showToast('File text extracted successfully!', 'success');
        } else {
            throw new Error('Unsupported format. Use PDF, TXT, or CSV.');
        }
    } catch (error) {
        notesInput.value = '';
        showToast(error.message || 'Failed to read file.', 'error');
    }
    event.target.value = '';
}

// --- API Fleet Auto-Switching Logic ---
async function callGeminiAPI(prompt, isJson = false) {
    if (apiFleet.length === 0) {
        showToast('No API keys configured! Go to API Admin tab to add your keys.', 'error');
        throw new Error("No API keys found. Please add keys in the API Admin panel.");
    }

    let attempts = 0;
    while (attempts < apiFleet.length) {
        const apiKey = apiFleet[currentApiIndex];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
        };

        if (isJson) requestBody.generationConfig.responseMimeType = "application/json";

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                if (response.status === 429) throw new Error("QUOTA_EXCEEDED");
                const errData = await response.json();
                throw new Error(errData.error?.message || 'API request failed');
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            if (error.message === "QUOTA_EXCEEDED" || error.message.includes("429")) {
                console.warn(`API Key at index ${currentApiIndex} exhausted limit. Auto-switching...`);
                currentApiIndex = (currentApiIndex + 1) % apiFleet.length;
                attempts++;
                showToast(`API Limit Reached. Switching to backup key...`, 'info');
                // continue while loop to retry with next key
            } else {
                throw error; // For generic errors like 400 Bad Request, fail immediately.
            }
        }
    }
    throw new Error('All API keys in the fleet have exceeded their quota.');
}

// --- Core Processing Pipeline ---
async function processNotes() {
    const pwd = document.getElementById('app-password-input').value.trim();
    if (pwd !== '12341234') {
        showToast('Incorrect App Password. Please enter the correct password to unlock.', 'error');
        return;
    }

    const notes = document.getElementById('notes-input').value.trim();
    if (notes.length < 50) return showToast('Notes are too short.', 'error');

    const topicName = document.getElementById('session-topic').value.trim() || `Study Session (${new Date().toLocaleTimeString()})`;
    const quizCount = document.getElementById('quiz-count').value;

    const btn = document.getElementById('process-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        // 1. Generate Summary
        switchTab('summary');
        showLoadingState('summary');
        const summaryMarkdown = await callGeminiAPI(`Summarize the following study notes in Markdown format. Notes: ${notes}`);
        generatedData.summary = summaryMarkdown;
        document.getElementById('summary-topic-title').innerText = topicName + " Summary";
        renderSummary(summaryMarkdown);

        // 2. Generate Flashcards
        switchTab('flashcards');
        showLoadingState('flashcards');
        const flashcardPrompt = `Extract top 6 facts as flashcards. Format as JSON array: [{"q":"question","a":"answer"}]. Notes: ${notes}`;
        const flashcards = JSON.parse(await callGeminiAPI(flashcardPrompt, true));
        generatedData.flashcards = flashcards;
        renderFlashcards(flashcards);

        // 3. Generate Quiz
        switchTab('quiz');
        showLoadingState('quiz');
        const quizPrompt = `Create a ${quizCount}-question multiple choice quiz. Return JSON array: [{"question":"Q?","options":["A","B","C","D"],"correctIndex":1,"explanation":"Exp"}]. Notes: ${notes}`;
        const quiz = JSON.parse(await callGeminiAPI(quizPrompt, true));
        generatedData.quiz = quiz;
        
        quizState = { currentQuestionIndex: 0, score: 0 };
        renderQuizQuestion();

        // Save Session History
        saveSession(topicName, notes, generatedData);

        showToast('Study materials generated successfully!', 'success');
        switchTab('summary'); 

    } catch (error) {
        console.error("Processing failed:", error);
        resetStatesOnError();
        showToast(`Generation Failed: ${error.message}`, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// --- History Logic ---
function saveSession(topic, rawNotes, data) {
    const session = {
        id: Date.now().toString(),
        date: new Date().toLocaleDateString(),
        topic: topic,
        rawNotes: rawNotes,
        data: JSON.parse(JSON.stringify(data)) // Deep copy
    };
    sessions.unshift(session); // Add to beginning
    localStorage.setItem('studyspark_history', JSON.stringify(sessions));
    renderHistoryList();
}

function renderHistoryList() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    
    list.innerHTML = '';
    if (sessions.length === 0) {
        empty.classList.remove('hidden');
        empty.classList.add('flex');
        return;
    }
    
    empty.classList.add('hidden');
    empty.classList.remove('flex');

    sessions.forEach(session => {
        const item = `
            <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex justify-between items-center hover:border-brand-500/50 transition-colors group">
                <div>
                    <h3 class="font-bold text-white text-lg">${session.topic}</h3>
                    <p class="text-xs text-slate-400 mt-1"><i class="fa-regular fa-calendar mr-1"></i> ${session.date}</p>
                </div>
                <button onclick="loadSession('${session.id}')" class="bg-slate-700 hover:bg-brand-600 text-white px-6 py-2 rounded-lg font-medium transition-colors opacity-0 group-hover:opacity-100">
                    Review Session
                </button>
            </div>
        `;
        list.insertAdjacentHTML('beforeend', item);
    });
}

function loadSession(id) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    generatedData = JSON.parse(JSON.stringify(session.data));
    document.getElementById('summary-topic-title').innerText = session.topic + " Summary";
    
    renderSummary(generatedData.summary);
    renderFlashcards(generatedData.flashcards);
    
    quizState = { currentQuestionIndex: 0, score: 0 };
    renderQuizQuestion();
    
    showToast(`Loaded ${session.topic}`);
    switchTab('summary');
}

function clearHistory() {
    if(confirm('Are you sure you want to delete all saved study sessions?')) {
        sessions = [];
        localStorage.removeItem('studyspark_history');
        renderHistoryList();
        showToast('History cleared.');
    }
}

// --- Export Logic (Word & PDF) ---
function getExportHTML() {
    const title = document.getElementById('summary-topic-title').innerText;
    const summaryHtml = document.getElementById('summary-content').innerHTML;
    
    let flashcardsHtml = '<h2>Flashcards</h2><ul>';
    if (generatedData.flashcards) {
        generatedData.flashcards.forEach(f => {
            flashcardsHtml += `<li><strong>Q:</strong> ${f.q}<br><strong>A:</strong> ${f.a}</li><br>`;
        });
    }
    flashcardsHtml += '</ul>';

    let quizHtml = '<h2>Practice Quiz (Answer Key)</h2><ul>';
    if (generatedData.quiz) {
        generatedData.quiz.forEach((q, i) => {
            quizHtml += `<li><strong>Q${i+1}: ${q.question}</strong><br>`;
            q.options.forEach((opt, oIdx) => {
                const isCorrect = oIdx === q.correctIndex;
                quizHtml += isCorrect ? `<b>[CORRECT] ${opt}</b><br>` : `- ${opt}<br>`;
            });
            quizHtml += `<i>Explanation: ${q.explanation}</i><br><br></li>`;
        });
    }
    quizHtml += '</ul>';

    return `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset='utf-8'>
            <title>${title}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #000; background: #fff; padding: 20px; }
                h1, h2, h3 { color: #1e293b; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
                p, li { line-height: 1.6; }
                ul { margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            ${summaryHtml}
            <hr>
            ${flashcardsHtml}
            <hr>
            ${quizHtml}
        </body>
        </html>
    `;
}

function exportWordDoc() {
    const html = getExportHTML();
    const title = document.getElementById('summary-topic-title').innerText;
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Word Document downloaded!', 'success');
}



// --- Admin Panel Logic ---
function unlockAdmin() {
    const pwd = document.getElementById('admin-pwd-input').value;
    if (pwd === '12341234') {
        document.getElementById('admin-auth-wall').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        showToast('Admin Panel Unlocked', 'success');
    } else {
        showToast('Incorrect password', 'error');
    }
}

function renderApiAdminList() {
    const list = document.getElementById('api-keys-list');
    list.innerHTML = '';
    apiFleet.forEach((key, idx) => {
        const masked = key.substring(0, 8) + '•••••••••••••••••' + key.substring(key.length - 4);
        const isActive = idx === currentApiIndex ? '<span class="text-xs bg-brand-500/20 text-brand-400 px-2 py-1 rounded">Active</span>' : '';
        const item = `
            <div class="flex justify-between items-center bg-slate-900 border border-slate-700 p-3 rounded-lg">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-key text-slate-500"></i>
                    <span class="font-mono text-sm text-slate-300">${masked}</span>
                    ${isActive}
                </div>
                <button onclick="removeApiKey(${idx})" class="text-red-400 hover:text-red-300 transition-colors"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        list.insertAdjacentHTML('beforeend', item);
    });
}

function addApiKey() {
    const input = document.getElementById('new-api-key');
    const val = input.value.trim();
    if (val.length < 20) return showToast('Invalid API Key format', 'error');
    
    apiFleet.push(val);
    localStorage.setItem('studyspark_api_fleet', JSON.stringify(apiFleet));
    input.value = '';
    renderApiAdminList();
    showToast('API Key added to fleet', 'success');
}

function removeApiKey(idx) {
    if (apiFleet.length <= 1) return showToast('Cannot remove the last API key', 'error');
    apiFleet.splice(idx, 1);
    if (currentApiIndex >= apiFleet.length) currentApiIndex = 0;
    localStorage.setItem('studyspark_api_fleet', JSON.stringify(apiFleet));
    renderApiAdminList();
}


// --- UI Rendering Helpers (Standard) ---
function showLoadingState(tab) {
    document.getElementById(`${tab}-empty`)?.classList.add('hidden');
    document.getElementById(`${tab}-content`)?.classList.add('hidden');
    document.getElementById(`${tab}-grid`)?.classList.add('hidden');
    document.getElementById(`${tab}-loading`)?.classList.remove('hidden');
    document.getElementById(`${tab}-loading`)?.classList.add('flex');
}

function resetStatesOnError() {
    if(!generatedData.summary) document.getElementById('summary-empty')?.classList.remove('hidden');
    document.getElementById('summary-loading')?.classList.add('hidden');
    
    if(!generatedData.flashcards) document.getElementById('flashcards-empty')?.classList.remove('hidden');
    document.getElementById('flashcards-loading')?.classList.add('hidden');
    
    if(!generatedData.quiz) document.getElementById('quiz-empty')?.classList.remove('hidden');
    document.getElementById('quiz-loading')?.classList.add('hidden');
}

function renderSummary(markdown) {
    const container = document.getElementById('summary-content');
    container.innerHTML = marked.parse(markdown);
    document.getElementById('summary-loading').classList.add('hidden');
    document.getElementById('summary-loading').classList.remove('flex');
    container.classList.remove('hidden');
}

function renderFlashcards(cards) {
    const grid = document.getElementById('flashcards-grid');
    grid.innerHTML = '';
    cards.forEach((card, index) => {
        grid.insertAdjacentHTML('beforeend', `
            <div class="flashcard-scene group" onclick="this.classList.toggle('is-flipped')">
                <div class="flashcard-inner shadow-lg">
                    <div class="flashcard-front flex flex-col justify-center items-center text-center group-hover:border-brand-500/50 transition-colors">
                        <span class="absolute top-4 left-4 text-xs font-semibold text-slate-500">Q${index + 1}</span>
                        <i class="fa-regular fa-lightbulb text-2xl text-brand-400 mb-4 opacity-50"></i>
                        <h4 class="text-lg font-medium text-slate-200">${card.q}</h4>
                    </div>
                    <div class="flashcard-back flex flex-col justify-center items-center text-center">
                        <span class="absolute top-4 left-4 text-xs font-semibold text-teal-200/50">Answer</span>
                        <p class="text-white font-medium text-lg">${card.a}</p>
                    </div>
                </div>
            </div>
        `);
    });
    document.getElementById('flashcards-loading').classList.add('hidden');
    document.getElementById('flashcards-loading').classList.remove('flex');
    grid.classList.remove('hidden');
}

function renderQuizQuestion() {
    const quizData = generatedData.quiz;
    if (!quizData || quizData.length === 0) return;

    const currentQ = quizData[quizState.currentQuestionIndex];
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-loading').classList.remove('flex');
    document.getElementById('quiz-empty').classList.add('hidden');
    document.getElementById('quiz-content').classList.remove('hidden');
    document.getElementById('quiz-content').classList.add('flex');
    document.getElementById('quiz-results').classList.add('hidden');

    document.getElementById('quiz-current-q').innerText = quizState.currentQuestionIndex + 1;
    document.getElementById('quiz-total-q').innerText = quizData.length;
    document.getElementById('quiz-score').innerText = quizState.score;
    document.getElementById('quiz-question-text').innerText = currentQ.question;
    
    const optionsContainer = document.getElementById('quiz-options');
    optionsContainer.innerHTML = '';
    const labels = ['A', 'B', 'C', 'D'];
    
    currentQ.options.forEach((opt, index) => {
        optionsContainer.insertAdjacentHTML('beforeend', `
            <button onclick="selectQuizOption(${index})" id="opt-${index}" class="w-full text-left p-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 transition-all flex items-center gap-4 group">
                <span class="w-8 h-8 rounded-lg bg-slate-900 text-slate-400 flex items-center justify-center font-bold text-sm group-hover:text-brand-400 group-hover:bg-slate-800 transition-colors">${labels[index]}</span>
                <span class="flex-1">${opt}</span><i id="icon-${index}" class="fa-solid hidden text-xl"></i>
            </button>
        `);
    });
    document.getElementById('quiz-feedback-area').classList.add('hidden');
    document.getElementById('quiz-feedback-area').classList.remove('flex');
}

function selectQuizOption(selectedIndex) {
    if (document.getElementById('quiz-feedback-area').classList.contains('flex')) return;
    const currentQ = generatedData.quiz[quizState.currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.correctIndex;

    currentQ.options.forEach((_, idx) => {
        const btn = document.getElementById(`opt-${idx}`);
        btn.classList.remove('hover:bg-slate-700/50', 'cursor-pointer');
        btn.classList.add('opacity-60', 'cursor-default');
    });

    const selectedBtn = document.getElementById(`opt-${selectedIndex}`);
    const correctBtn = document.getElementById(`opt-${currentQ.correctIndex}`);

    if (isCorrect) {
        quizState.score++; document.getElementById('quiz-score').innerText = quizState.score;
        selectedBtn.classList.replace('border-slate-700', 'border-brand-500');
        selectedBtn.classList.replace('bg-slate-800/50', 'bg-brand-500/20');
        selectedBtn.classList.remove('opacity-60');
        document.getElementById(`icon-${selectedIndex}`).classList.replace('hidden', 'fa-circle-check');
        document.getElementById(`icon-${selectedIndex}`).classList.add('text-brand-500');
    } else {
        selectedBtn.classList.replace('border-slate-700', 'border-red-500');
        selectedBtn.classList.replace('bg-slate-800/50', 'bg-red-500/20');
        selectedBtn.classList.remove('opacity-60');
        document.getElementById(`icon-${selectedIndex}`).classList.replace('hidden', 'fa-circle-xmark');
        document.getElementById(`icon-${selectedIndex}`).classList.add('text-red-500');

        correctBtn.classList.replace('border-slate-700', 'border-brand-500');
        correctBtn.classList.replace('bg-slate-800/50', 'bg-brand-500/10');
        correctBtn.classList.remove('opacity-60');
        document.getElementById(`icon-${currentQ.correctIndex}`).classList.replace('hidden', 'fa-circle-check');
        document.getElementById(`icon-${currentQ.correctIndex}`).classList.add('text-brand-500');
    }

    const feedbackText = document.getElementById('quiz-feedback-text');
    feedbackText.innerHTML = isCorrect ? 
        `<span class="text-brand-400"><i class="fa-solid fa-check mr-2"></i>Correct!</span> ${currentQ.explanation}` : 
        `<span class="text-red-400"><i class="fa-solid fa-xmark mr-2"></i>Incorrect.</span> ${currentQ.explanation}`;
    
    document.getElementById('quiz-feedback-area').classList.remove('hidden');
    document.getElementById('quiz-feedback-area').classList.add('flex', 'animation-fade-in');
    if (quizState.currentQuestionIndex === generatedData.quiz.length - 1) {
        document.getElementById('quiz-next-btn').innerHTML = 'Finish Quiz <i class="fa-solid fa-flag-checkered ml-1"></i>';
    }
}

function nextQuizQuestion() {
    if (quizState.currentQuestionIndex < generatedData.quiz.length - 1) {
        quizState.currentQuestionIndex++; renderQuizQuestion();
    } else {
        document.getElementById('quiz-content').children[0].classList.add('hidden');
        document.getElementById('quiz-content').children[1].classList.add('hidden');
        document.getElementById('quiz-feedback-area').classList.add('hidden');
        document.getElementById('quiz-feedback-area').classList.remove('flex');
        
        const resultsArea = document.getElementById('quiz-results');
        resultsArea.classList.remove('hidden'); resultsArea.classList.add('flex', 'animation-fade-in');
        
        document.getElementById('quiz-final-score').innerText = quizState.score;
        document.getElementById('quiz-final-total').innerText = generatedData.quiz.length;
    }
}

function resetQuiz() {
    quizState.currentQuestionIndex = 0; quizState.score = 0;
    document.getElementById('quiz-content').children[0].classList.remove('hidden');
    document.getElementById('quiz-content').children[1].classList.remove('hidden');
    document.getElementById('quiz-next-btn').innerHTML = 'Next Question <i class="fa-solid fa-arrow-right ml-1"></i>';
    renderQuizQuestion();
}

// --- Answer Key Logic ---
function showAnswerKey() {
    if (!generatedData.quiz) return;
    
    document.getElementById('quiz-header').classList.add('hidden');
    document.getElementById('quiz-q-area').classList.add('hidden');
    document.getElementById('quiz-feedback-area').classList.add('hidden');
    document.getElementById('quiz-feedback-area').classList.remove('flex');
    document.getElementById('quiz-results').classList.add('hidden');
    document.getElementById('quiz-results').classList.remove('flex');
    
    const akList = document.getElementById('answer-key-list');
    akList.innerHTML = '';
    
    generatedData.quiz.forEach((q, idx) => {
        let optionsHtml = '';
        q.options.forEach((opt, oIdx) => {
            const isCorrect = oIdx === q.correctIndex;
            const style = isCorrect ? 'text-brand-400 font-bold' : 'text-slate-400';
            const icon = isCorrect ? '<i class="fa-solid fa-check mr-2"></i>' : '';
            optionsHtml += `<li class="${style} mb-1">${icon}${opt}</li>`;
        });
        
        akList.insertAdjacentHTML('beforeend', `
            <div class="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50">
                <h4 class="text-lg font-semibold text-white mb-3">Q${idx + 1}: ${q.question}</h4>
                <ul class="list-none mb-4 pl-2">${optionsHtml}</ul>
                <div class="bg-brand-500/10 border border-brand-500/20 p-3 rounded-lg text-sm text-slate-300">
                    <span class="text-brand-400 font-bold mr-1">Explanation:</span> ${q.explanation}
                </div>
            </div>
        `);
    });
    
    document.getElementById('quiz-answer-key').classList.remove('hidden');
    document.getElementById('quiz-answer-key').classList.add('block');
}

function hideAnswerKey() {
    document.getElementById('quiz-answer-key').classList.add('hidden');
    document.getElementById('quiz-answer-key').classList.remove('block');
    
    document.getElementById('quiz-header').classList.remove('hidden');
    if (quizState.currentQuestionIndex >= generatedData.quiz.length) {
        document.getElementById('quiz-results').classList.remove('hidden');
        document.getElementById('quiz-results').classList.add('flex');
    } else {
        document.getElementById('quiz-q-area').classList.remove('hidden');
        if (document.getElementById('quiz-feedback-text').innerHTML !== '') {
            document.getElementById('quiz-feedback-area').classList.remove('hidden');
            document.getElementById('quiz-feedback-area').classList.add('flex');
        }
    }
}
