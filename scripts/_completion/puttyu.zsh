#compdef puttyu puttyu-calendar puttyu-cookbook puttyu-docs puttyu-mcp puttyu-memory puttyu-notes puttyu-personal puttyu-preset puttyu-research puttyu-sessions puttyu-skills puttyu-tasks puttyu-theme
# Zsh tab-completion for the puttyu umbrella + sub-CLIs.
#
# Drop in any directory on $fpath, e.g.:
#     fpath=(/path/to/puttyu-ui/scripts/_completion $fpath)
#     autoload -U compinit; compinit
#
# Then `puttyu <tab>` completes subcommands; `puttyu notes <tab>`
# completes notes subcommands; `puttyu-notes <tab>` works the same.

_puttyu_scripts_dir() {
    local self="${(%):-%x}"
    while [[ -L "$self" ]]; do self="$(readlink "$self")"; done
    cd "${self:h}/.." && pwd
}

typeset -gA _puttyu_subs

_puttyu_refresh() {
    _puttyu_subs=()
    local dir="$(_puttyu_scripts_dir)"
    local py="$dir/../venv/bin/python"
    [[ -x "$py" ]] || py="$(command -v python3)"
    local f sub help_out commands
    for f in "$dir"/puttyu-*; do
        [[ -x "$f" ]] || continue
        case "$f" in
            *.bak|*.pyc|*.pre-*) continue ;;
        esac
        sub="${${f:t}#puttyu-}"
        help_out=$("$py" "$f" --help 2>/dev/null) || continue
        commands=$(echo "$help_out" | grep -oE '\{[a-z0-9_,-]+\}' | head -1 \
            | tr -d '{}' | tr ',' ' ')
        _puttyu_subs[$sub]="$commands"
    done
}

_puttyu() {
    [[ ${#_puttyu_subs} -eq 0 ]] && _puttyu_refresh

    local cmd="${words[1]}"

    if [[ "$cmd" == "puttyu" ]]; then
        if (( CURRENT == 2 )); then
            local -a subs=(${(k)_puttyu_subs} help)
            _describe 'subcommand' subs
            return
        fi
        local sub="${words[2]}"
        if [[ "$sub" == "help" ]] && (( CURRENT == 3 )); then
            local -a subs=(${(k)_puttyu_subs})
            _describe 'subcommand' subs
            return
        fi
        if (( CURRENT == 3 )); then
            local -a sc=(${(s/ /)_puttyu_subs[$sub]})
            _describe 'command' sc
            return
        fi
        return
    fi

    # puttyu-foo <tab>
    local sub="${cmd#puttyu-}"
    if (( CURRENT == 2 )); then
        local -a sc=(${(s/ /)_puttyu_subs[$sub]})
        _describe 'command' sc
        return
    fi
}

_puttyu "$@"
