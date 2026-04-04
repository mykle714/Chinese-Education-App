import React from "react";
import CharacterPinyinColorDisplay from "../../components/CharacterPinyinColorDisplay";
import { BreakdownLineItem, DefinitionColumn, DefinitionText } from "./styled";

const BreakdownLineItemComponent: React.FC<{
    character: string;
    pinyin: string;
    definition: string;
}> = ({ character, pinyin, definition }) => (
    <BreakdownLineItem className="mobile-demo-breakdown-item">
        <CharacterPinyinColorDisplay
            character={character}
            pinyin={pinyin}
            size="sm"
            useToneColor={true}
            showPinyin={true}
        />
        <DefinitionColumn className="mobile-demo-definition-column">
            <DefinitionText className="mobile-demo-definition-text">{definition}</DefinitionText>
        </DefinitionColumn>
    </BreakdownLineItem>
);

export default BreakdownLineItemComponent;
